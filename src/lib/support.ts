// The NimBooks donation address is public on purpose: it is the owner's
// receiving address, shown on the landing support card and in the app's
// changelog modal. Supporter privacy lives server-side (functions/_lib), never
// in this bundle: this file must never hold a supporter's address.
export const DONATION_ADDRESS = 'NQ39 XC3L JHXL 5GKB K09G J765 X577 PS3A KHFE'

// Scanner QRs carry the bare address, no URI scheme: that is how the app's own
// receive QR works (src/App.tsx), and every wallet scanner reads it.
export const DONATION_QR_VALUE = 'NQ39XC3LJHXL5GKBK09GJ765X577PS3AKHFE'

// The memo the app's prefilled send sheet (changelog modal link) attaches.
export const DONATION_MEMO = 'NimBooks donation'