import { Platform } from 'react-native';
import * as RNIap from 'react-native-iap';

import { supabase } from '@/lib/supabase';

// Premium subscription (2026-08-01), same proven pattern as
// src/lib/ai-credits.ts's consumable pack purchase, adapted for a
// subscription: react-native-iap's subscription API (getSubscriptions/
// requestSubscription) is a real, distinct surface from the one-time-
// purchase API that function uses, confirmed by reading the installed
// package's own type definitions before writing this rather than
// assuming the shapes match. iOS's RequestSubscription is identical to a
// plain purchase request ({sku}); Android's requires a real
// subscriptionOffers array with an offerToken pulled from
// getSubscriptions' own response (Play Billing's offer system), not just
// a bare product id, this is the one genuinely different piece of logic
// from the credits flow.
export const PREMIUM_PRODUCT_ID = 'premium_monthly';

export async function getPremiumStatus(
  userId: string
): Promise<{ isPremium: boolean; premiumUntil: string | null }> {
  const { data } = await supabase.from('users').select('is_premium, premium_until').eq('id', userId).maybeSingle();
  return { isPremium: Boolean(data?.is_premium), premiumUntil: data?.premium_until ?? null };
}

export type PurchaseResult =
  | { status: 'success'; isPremium: boolean; premiumUntil: string | null }
  | { status: 'cancelled' }
  | { status: 'error'; message: string };

// Same standing limitation as ai-credits.ts: react-native-iap requires a
// real native dev build, no web or Expo Go equivalent. The logic here is
// written to be correct end to end; the native purchase sheet itself is
// what can't be exercised in this dev environment.
export async function purchasePremiumSubscription(): Promise<PurchaseResult> {
  await RNIap.initConnection();

  try {
    const subscriptions = await RNIap.getSubscriptions({ skus: [PREMIUM_PRODUCT_ID] });
    if (subscriptions.length === 0) {
      return { status: 'error', message: 'This subscription is not configured in the App Store / Play Console yet.' };
    }

    const purchase = await new Promise<RNIap.SubscriptionPurchase | RNIap.SubscriptionPurchase[] | null | void>(
      (resolve, reject) => {
        const updateSub = RNIap.purchaseUpdatedListener((p: RNIap.Purchase) => {
          updateSub.remove();
          errorSub.remove();
          resolve(p as RNIap.SubscriptionPurchase);
        });
        const errorSub = RNIap.purchaseErrorListener((err: RNIap.PurchaseError) => {
          updateSub.remove();
          errorSub.remove();
          if (err.code === 'E_USER_CANCELLED') {
            resolve(null);
            return;
          }
          reject(err);
        });

        const request: RNIap.RequestSubscription =
          Platform.OS === 'android'
            ? {
                subscriptionOffers: [
                  {
                    sku: PREMIUM_PRODUCT_ID,
                    offerToken:
                      (subscriptions[0] as RNIap.SubscriptionAndroid).subscriptionOfferDetails?.[0]?.offerToken ?? '',
                  },
                ],
              }
            : { sku: PREMIUM_PRODUCT_ID };

        RNIap.requestSubscription(request).catch((err) => {
          updateSub.remove();
          errorSub.remove();
          reject(err);
        });
      }
    );

    const resolvedPurchase = Array.isArray(purchase) ? purchase[0] : purchase;
    if (!resolvedPurchase) {
      return { status: 'cancelled' };
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return { status: 'error', message: 'Not signed in.' };
    }

    const { data, error } = await supabase.functions.invoke('validate-premium-purchase', {
      body: {
        platform: Platform.OS === 'ios' ? 'ios' : 'android',
        productId: PREMIUM_PRODUCT_ID,
        transactionId: resolvedPurchase.transactionId ?? resolvedPurchase.transactionReceipt,
        receiptData: Platform.OS === 'ios' ? resolvedPurchase.transactionReceipt : (resolvedPurchase.purchaseToken ?? ''),
        packageName: Platform.OS === 'android' ? 'com.friendshipapp' : undefined,
      },
    });

    if (error || !data?.success) {
      // Same deliberate choice as ai-credits.ts: don't finish/consume the
      // transaction on a failed server-side validation, leave it
      // recoverable on the platform's own side.
      return { status: 'error', message: data?.error ?? error?.message ?? 'Could not verify this purchase.' };
    }

    await RNIap.finishTransaction({ purchase: resolvedPurchase, isConsumable: false });

    return { status: 'success', isPremium: Boolean(data.isPremium), premiumUntil: data.premiumUntil ?? null };
  } finally {
    await RNIap.endConnection();
  }
}

// Real restore, a distinct RNIap call from a fresh purchase
// (getAvailablePurchases reads what the platform already has on record
// for this account, it never opens a new purchase sheet). Re-validates
// each existing purchase the same way a fresh one is validated, so a
// reinstall or a new device correctly recovers Premium status, and (see
// this module's own header comment on the missing-webhook limitation)
// this is also what re-syncs a renewal that happened while the app
// wasn't open, the next time it is.
export async function restorePremiumPurchase(): Promise<PurchaseResult> {
  await RNIap.initConnection();
  try {
    const purchases = await RNIap.getAvailablePurchases();
    const match = purchases.find((p) => p.productId === PREMIUM_PRODUCT_ID);
    if (!match) {
      return { status: 'error', message: 'No previous purchase found for this account.' };
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return { status: 'error', message: 'Not signed in.' };
    }

    const { data, error } = await supabase.functions.invoke('validate-premium-purchase', {
      body: {
        platform: Platform.OS === 'ios' ? 'ios' : 'android',
        productId: PREMIUM_PRODUCT_ID,
        transactionId: match.transactionId ?? match.transactionReceipt,
        receiptData: Platform.OS === 'ios' ? match.transactionReceipt : (match.purchaseToken ?? ''),
        packageName: Platform.OS === 'android' ? 'com.friendshipapp' : undefined,
      },
    });

    if (error || !data?.success) {
      return { status: 'error', message: data?.error ?? error?.message ?? 'Could not verify this purchase.' };
    }

    return { status: 'success', isPremium: Boolean(data.isPremium), premiumUntil: data.premiumUntil ?? null };
  } finally {
    await RNIap.endConnection();
  }
}
