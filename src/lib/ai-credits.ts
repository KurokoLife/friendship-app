import { Platform } from 'react-native';
import * as RNIap from 'react-native-iap';

import { supabase } from '@/lib/supabase';

// Consumable AI top-up packs (2026-07-29). One product: 50 credits for
// $1.99, price itself is set in App Store Connect / Play Console against
// this product id, never hardcoded here, this is only the identifier.
export const AI_CREDIT_PACK_PRODUCT_ID = 'ai_credits_50';

export async function getAiCreditsBalance(userId: string): Promise<number> {
  const { data } = await supabase.from('users').select('ai_credits').eq('id', userId).maybeSingle();
  return data?.ai_credits ?? 0;
}

export type PurchaseResult =
  | { status: 'success'; newBalance: number }
  | { status: 'cancelled' }
  | { status: 'error'; message: string };

// react-native-iap requires a real native dev build (StoreKit/Play
// Billing are native modules, no web or Expo Go equivalent exists), a
// standing limitation this project has already flagged for other native
// features (voice-to-text, deepidv). This function is written to be
// correct end to end, the part that can't be exercised in this dev
// environment is the native purchase sheet itself, not the logic here.
//
// The actual trust boundary is server-side: this function's job ends at
// "hand the platform's own receipt/token to validate-ai-credit-purchase
// and report what it says", it never credits ai_credits itself and never
// trusts RNIap's own purchase-success callback as authoritative on its
// own, see that Edge Function's own header comment for why.
export async function purchaseAiCreditPack(): Promise<PurchaseResult> {
  await RNIap.initConnection();

  try {
    const products = await RNIap.getProducts({ skus: [AI_CREDIT_PACK_PRODUCT_ID] });
    if (products.length === 0) {
      return { status: 'error', message: 'This product is not configured in the App Store / Play Console yet.' };
    }

    const purchase = await new Promise<RNIap.Purchase | null>((resolve, reject) => {
      const updateSub = RNIap.purchaseUpdatedListener((p: RNIap.Purchase) => {
        updateSub.remove();
        errorSub.remove();
        resolve(p);
      });
      const errorSub = RNIap.purchaseErrorListener((err: RNIap.PurchaseError) => {
        updateSub.remove();
        errorSub.remove();
        // userCancelledError covers both platforms' "tapped out of the
        // purchase sheet" case, treated as a real, expected outcome, not
        // a failure to surface an error for.
        if (err.code === 'E_USER_CANCELLED') {
          resolve(null);
          return;
        }
        reject(err);
      });

      RNIap.requestPurchase({ skus: [AI_CREDIT_PACK_PRODUCT_ID] }).catch((err) => {
        updateSub.remove();
        errorSub.remove();
        reject(err);
      });
    });

    if (!purchase) {
      return { status: 'cancelled' };
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return { status: 'error', message: 'Not signed in.' };
    }

    const { data, error } = await supabase.functions.invoke('validate-ai-credit-purchase', {
      body: {
        platform: Platform.OS === 'ios' ? 'ios' : 'android',
        productId: AI_CREDIT_PACK_PRODUCT_ID,
        transactionId: purchase.transactionId ?? purchase.transactionReceipt,
        receiptData: Platform.OS === 'ios' ? purchase.transactionReceipt : (purchase.purchaseToken ?? ''),
        packageName: Platform.OS === 'android' ? 'com.friendshipapp' : undefined,
      },
    });

    if (error || !data?.success) {
      // Deliberately does NOT finish/consume the transaction on a failed
      // server-side validation, an unvalidated purchase should stay
      // pending on the platform's own side (recoverable, e.g. retried
      // next app open via getAvailablePurchases) rather than being
      // silently discarded because our own validation call happened to
      // fail this one time.
      return { status: 'error', message: data?.error ?? error?.message ?? 'Could not verify this purchase.' };
    }

    // Only acknowledge/consume the platform-side transaction after our
    // own server has confirmed it and credited the account, so a crash
    // or lost network response between purchase and validation leaves
    // the transaction recoverable rather than credited-then-lost.
    await RNIap.finishTransaction({ purchase, isConsumable: true });

    return { status: 'success', newBalance: data.newBalance as number };
  } finally {
    await RNIap.endConnection();
  }
}
