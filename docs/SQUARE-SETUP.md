# Paying online with Square — setup

Guests tap **Pay $X by card** on *My wins*, pay on Square's secure page, and the app credits their balance only after
Square confirms the payment. Nothing here ever sees or stores a card number.

Switched **off** until an administrator ticks *Let guests pay online (Square)* under Admin → Power-Ups & game.

## 1. Square (about 10 minutes)
1. Go to https://developer.squareup.com and sign in with the church's Square account → **Create an application** (name: StoryChurch Auction).
2. **Sandbox first.** In the app's *Credentials* page choose **Sandbox** and copy the **Sandbox access token**. Under *Locations* copy the **Sandbox location ID**.
3. **Webhooks → Subscriptions → Add subscription** (Sandbox):
   - URL: `https://auction.storychurch.co/api/webhooks/square`  (must match exactly)
   - Event: `payment.updated`
   - Save, then copy the **Signature key**.

## 2. Vercel → Settings → Environment Variables (Production)
| Name | Value |
|---|---|
| `SQUARE_ENV` | `sandbox` (later `production`) |
| `SQUARE_ACCESS_TOKEN` | the access token |
| `SQUARE_LOCATION_ID` | the location ID |
| `SQUARE_WEBHOOK_SIGNATURE_KEY` | the signature key |

Redeploy after changing them. The admin page shows **Square keys found** once they are present.

## 3. Test in sandbox, then go live
1. Tick *Let guests pay online* and save. Win a test item as a test guest, tap **Pay by card**, and use Square's sandbox test card `4111 1111 1111 1111` (any future date, any CVV/ZIP).
2. You should land back on *My wins* with the balance at $0, and a "Online (Square)" payment in the staff checkout screen.
3. **Go live:** switch the four values to the **Production** token / location / signature key (create a *Production* webhook subscription with the same URL and `payment.updated`), set `SQUARE_ENV=production`, redeploy, and do one real $1 test payment (then void it in Checkout and refund it in Square).

## If something goes wrong on the night
Untick *Let guests pay online* — the button disappears and everything else works exactly as before (cash, check, card at the table).

## Good to know
- The amount is computed by the server from the guest's real balance. The browser can't change it.
- If Square's message is late, the app asks Square when the guest returns to *My wins* (and when staff open that guest's checkout), so a paid guest is never left unpaid.
- If a guest also paid at the desk meanwhile, only what they still owed is credited and the rest is flagged **"refund it in Square"** on their staff checkout page.
- Voiding an online payment in Checkout reopens the balance; refund the money in Square's dashboard.
- Square charges its normal card fees on these payments. Check current rates for your account.
