// mobile/lib/quotePdf.ts
//
// Turns the proposal HTML (lib/proposalHtml) into a PDF on device via
// expo-print, then opens the OS share sheet via expo-sharing so the
// contractor can text/email/AirDrop the estimate to the customer.

import * as Print from 'expo-print'
import * as Sharing from 'expo-sharing'
import { Platform } from 'react-native'

/**
 * Render `html` to a PDF and present the share sheet.
 * Returns the generated file uri (already shared), or throws on failure.
 */
export async function shareProposalPdf(html: string, _filename = 'Estimate.pdf'): Promise<string> {
  const { uri } = await Print.printToFileAsync({ html, base64: false })
  const canShare = await Sharing.isAvailableAsync()
  if (canShare) {
    await Sharing.shareAsync(uri, {
      mimeType: 'application/pdf',
      dialogTitle: 'Share estimate',
      UTI: 'com.adobe.pdf'
    })
  } else if (Platform.OS === 'ios') {
    // Fallback: hand to the native print dialog if the share sheet is
    // unavailable (rare on device; common on simulator without share).
    await Print.printAsync({ html })
  }
  return uri
}
