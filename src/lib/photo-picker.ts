import * as ImagePicker from 'expo-image-picker';
import { Platform } from 'react-native';

// One place for "choose a photo from my device", used by profile photos.
//
// Bug fixed 2026-10-05: on the web the old code guessed the file type from
// the end of the image address. A web image address is a long "data:..."
// string with no file extension, so the guess produced a broken file name
// and type, and every upload from the web silently failed.
//
// Rules, shown to the person next to the button:
//   JPG, PNG or WebP, up to 10 MB.
// On the web the file chooser only lists those file types. On phones the
// photo library is used; iPhone HEIC photos are converted to JPG by the
// picker (quality < 1 forces re-encoding), so they work too.

export const PHOTO_RULES_TEXT = 'JPG, PNG or WebP, up to 10 MB.';
export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

const ALLOWED: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};
const WEB_ACCEPT = '.jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp';

export type PickedPhoto = { base64: string; contentType: string; ext: string; uri: string };
export type PickPhotoResult =
  | { ok: true; photo: PickedPhoto }
  | { ok: false; message: string }
  | { ok: false; cancelled: true };

function byteLength(base64: string): number {
  return Math.floor((base64.length * 3) / 4);
}

function check(contentType: string, base64: string, uri: string): PickPhotoResult {
  const type = contentType.toLowerCase();
  const ext = ALLOWED[type];
  if (!ext) {
    return { ok: false, message: `That file type isn't supported. Please choose a ${PHOTO_RULES_TEXT}` };
  }
  if (byteLength(base64) > MAX_PHOTO_BYTES) {
    return { ok: false, message: `That photo is too large. Please choose a ${PHOTO_RULES_TEXT}` };
  }
  return { ok: true, photo: { base64, contentType: type === 'image/jpg' ? 'image/jpeg' : type, ext, uri } };
}

function pickOnWeb(): Promise<PickPhotoResult> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = WEB_ACCEPT;
    input.style.display = 'none';
    let settled = false;
    const done = (result: PickPhotoResult) => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(result);
    };
    input.addEventListener('cancel', () => done({ ok: false, cancelled: true }));
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) return done({ ok: false, cancelled: true });
      if (!ALLOWED[file.type.toLowerCase()]) {
        return done({ ok: false, message: `That file type isn't supported. Please choose a ${PHOTO_RULES_TEXT}` });
      }
      if (file.size > MAX_PHOTO_BYTES) {
        return done({ ok: false, message: `That photo is too large. Please choose a ${PHOTO_RULES_TEXT}` });
      }
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = String(reader.result ?? '');
        const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
        done(check(file.type, base64, dataUrl));
      };
      reader.onerror = () => done({ ok: false, message: "We couldn't read that photo. Try a different one." });
      reader.readAsDataURL(file);
    });
    document.body.appendChild(input);
    input.click();
  });
}

export async function pickProfilePhoto(): Promise<PickPhotoResult> {
  if (Platform.OS === 'web') return pickOnWeb();

  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) {
    return { ok: false, message: 'We need permission to access your photos to set a profile photo.' };
  }
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    quality: 0.7,
    base64: true,
    allowsEditing: true,
    aspect: [1, 1],
  });
  const asset = result.assets?.[0];
  if (result.canceled || !asset?.base64) return { ok: false, cancelled: true };
  // After re-encoding the picker returns JPEG unless the source was PNG.
  const contentType = asset.mimeType ?? (asset.uri.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg');
  return check(contentType, asset.base64, asset.uri);
}
