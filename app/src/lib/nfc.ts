import { Platform } from 'react-native';
import NfcManager, { NfcAdapter, NfcTech } from 'react-native-nfc-manager';

let startup: Promise<boolean> | null = null;

/** Starts the NFC manager once per app run. Resolves false on phones without NFC. */
export function nfcSupported(): Promise<boolean> {
  startup ??= NfcManager.isSupported()
    .then(async (supported) => {
      if (supported) await NfcManager.start();
      return supported;
    })
    .catch(() => false);
  return startup;
}

export const nfcEnabled = () => NfcManager.isEnabled().catch(() => false);
export const openNfcSettings = () => NfcManager.goToNfcSetting().catch(() => false);

// Cancelling tears Android reader mode down after a 1 s delay; a new read must wait for that,
// otherwise the late teardown would silently kill the new read.
let cancelling: Promise<void> = Promise.resolve();
export function cancelTagRead(): Promise<void> {
  cancelling = NfcManager.cancelTechnologyRequest().catch(() => {});
  return cancelling;
}

/**
 * Waits for a tag and returns its hardware UID (upper-case hex). The tags at places are
 * NTAG stickers: NFC-A on Android, MIFARE on iOS. On iOS this shows the system scan sheet.
 */
export async function readTag(prompt: string): Promise<string> {
  await cancelling;
  try {
    await NfcManager.requestTechnology(Platform.OS === 'ios' ? NfcTech.MifareIOS : NfcTech.NfcA, {
      isReaderModeEnabled: true,
      readerModeFlags: NfcAdapter.FLAG_READER_NFC_A,
      alertMessage: prompt,
    });
    const tag = await NfcManager.getTag();
    if (!tag?.id) throw new Error('No tag id');
    return tag.id.toUpperCase();
  } finally {
    cancelTagRead();
  }
}
