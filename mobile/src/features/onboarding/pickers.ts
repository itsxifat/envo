import { Alert } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

import type { PickedFile } from '@/state/session';

/** Long side of an uploaded photo: sharp enough to read an NID, small enough to send quickly. */
const MAX_SIDE = 1600;

/** An upright JPEG of at most MAX_SIDE pixels. */
export async function shrink(uri: string, width?: number, height?: number): Promise<string> {
  let w = width ?? 0;
  let h = height ?? 0;
  if (!w || !h) {
    const probe = await ImageManipulator.manipulate(uri).renderAsync();
    w = probe.width;
    h = probe.height;
  }
  const ctx = ImageManipulator.manipulate(uri);
  if (Math.max(w, h) > MAX_SIDE) ctx.resize(w >= h ? { width: MAX_SIDE } : { height: MAX_SIDE });
  const image = await ctx.renderAsync();
  return (await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.82 })).uri;
}

export type Source = 'camera' | 'gallery' | 'files';

/**
 * A photo from the camera or the gallery, or a photo or PDF from the phone's files. `selfie` uses the
 * front camera and a square crop; an ID side is cropped like a card. Null when the person backs out.
 */
export async function pickFile(source: Source, opts: { selfie?: boolean } = {}): Promise<PickedFile | null> {
  if (source === 'files') {
    const r = await DocumentPicker.getDocumentAsync({ type: ['image/*', 'application/pdf'], copyToCacheDirectory: true });
    const a = r.canceled ? null : r.assets[0];
    if (!a) return null;
    if (a.mimeType === 'application/pdf' || a.name.toLowerCase().endsWith('.pdf')) return { uri: a.uri, kind: 'pdf' };
    return { uri: await shrink(a.uri), kind: 'image' };
  }
  const crop = { allowsEditing: true, aspect: (opts.selfie ? [1, 1] : [16, 10]) as [number, number], quality: 0.9 };
  let result: ImagePicker.ImagePickerResult;
  if (source === 'camera') {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Camera is off for Envo', 'Allow the camera in your phone settings, or choose a photo from your gallery instead.');
      return null;
    }
    result = await ImagePicker.launchCameraAsync({ ...crop, cameraType: opts.selfie ? ImagePicker.CameraType.front : ImagePicker.CameraType.back });
  } else {
    result = await ImagePicker.launchImageLibraryAsync({ ...crop, mediaTypes: ['images'] });
  }
  const a = result.canceled ? null : result.assets[0];
  return a ? { uri: await shrink(a.uri, a.width, a.height), kind: 'image' } : null;
}
