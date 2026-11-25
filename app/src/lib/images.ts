import { Alert } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { File } from 'expo-file-system';
import type { T } from './i18n';
import { supabase } from './supabase';

/** Lets the user take a square photo or pick one. Resolves the local uri, or null if cancelled. */
export function pickImage(t: T): Promise<string | null> {
  return new Promise((resolve) => {
    const launch = async (source: 'camera' | 'library') => {
      const permission = source === 'camera'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert(t('permissionNeeded'), t('permissionText'));
        return resolve(null);
      }
      const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 1 };
      const result = source === 'camera'
        ? await ImagePicker.launchCameraAsync(options)
        : await ImagePicker.launchImageLibraryAsync(options);
      resolve(result.canceled ? null : result.assets[0].uri);
    };

    Alert.alert(t('addPhoto'), undefined, [
      { text: t('takePhoto'), onPress: () => launch('camera') },
      { text: t('chooseFromGallery'), onPress: () => launch('library') },
      { text: t('cancel'), style: 'cancel', onPress: () => resolve(null) },
    ], { cancelable: true, onDismiss: () => resolve(null) });
  });
}

/** Shrinks the photo to 512 px wide and uploads it as the user's avatar. Returns its public URL. */
export async function uploadAvatar(userId: string, uri: string): Promise<string> {
  const context = ImageManipulator.manipulate(uri);
  context.resize({ width: 512 });
  const rendered = await context.renderAsync();
  const saved = await rendered.saveAsync({ compress: 0.7, format: SaveFormat.JPEG });

  const bytes = await new File(saved.uri).arrayBuffer();
  const path = `${userId}/${Date.now()}.jpg`;
  // The bucket name dates from the app's first version; it now only holds avatars.
  const { error } = await supabase.storage.from('treasure-images').upload(path, bytes, { contentType: 'image/jpeg' });
  if (error) throw error;
  return supabase.storage.from('treasure-images').getPublicUrl(path).data.publicUrl;
}
