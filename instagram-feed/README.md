# WoodHatch live Instagram feed

The "Recent projects" rail on the site shows the latest posts from @wood__hatch.
New posts appear on the site within about an hour. Until this is set up, or if
Instagram is ever unreachable, the rail shows the built in photos in `img/`.

```
Instagram  →  Cloudflare Worker (holds the token, caches 1 hour)  →  website
```

Total time: about 20 minutes, once. Costs nothing on the free plans.

---

## Part 1 — The owner (Instagram + Meta, ~15 min)

1. **Switch to a professional account**
   Instagram app → Settings → Account type and tools → *Switch to professional account*
   → choose **Business** (or Creator). Free, and the posts stay as they are.

2. **Create a Meta app**
   - Go to https://developers.facebook.com → log in → **My Apps → Create app**.
   - Use case: **Manage messaging & content on Instagram** (wording may vary slightly).
   - Name it `WoodHatch Website`.

3. **Connect the Instagram account and get a token**
   - In the app: **Instagram → API setup with Instagram login**.
   - Under *Generate access tokens*, click **Add account** and log in as `wood__hatch`.
   - Click **Generate token** next to the account and copy it.
     This is a long lived token (valid 60 days; the Worker renews it automatically).

4. Send the token to the developer privately (not by email in plain text if you can avoid
   it; a password manager share or in person is best). It only gives read access to the
   account's posts, but treat it like a password.

> The app can stay in **Development mode**. Reading your own account's posts does not
> need Meta's app review.

---

## Part 2 — The developer (Cloudflare Worker, ~5 min)

Needs Node.js and a free Cloudflare account.

```bash
cd instagram-feed
npx wrangler login
npx wrangler kv namespace create IG
```

Paste the printed `id` into `wrangler.toml` (replace `PASTE_KV_NAMESPACE_ID_HERE`).

```bash
npx wrangler secret put IG_TOKEN
npx wrangler deploy
```

`secret put` asks for the token from Part 1. `deploy` prints the Worker address, e.g.
`https://woodhatch-instagram.<your-subdomain>.workers.dev`.

**Check it:** open `<that address>/feed` in a browser. You should see JSON with `posts`.

**Connect the site:** in `index.html`, find `<section id="feed" … data-feed="">` and paste
the address with `/feed` on the end:

```html
<section id="feed" style="padding-top:0" data-feed="https://woodhatch-instagram.<your-subdomain>.workers.dev/feed">
```

**Lock it down:** in `wrangler.toml`, set `ALLOWED_ORIGIN` to the real site address
(e.g. `"https://woodhatch.ng"`; several can be comma separated), then `npx wrangler deploy` again.

---

## How it keeps running

| What | How |
|---|---|
| New posts | Worker asks Instagram at most once an hour, caches the answer |
| Token expiry (60 days) | Daily cron renews it once it is 7+ days old and saves it in KV |
| Instagram down / error | Worker serves the last good copy; if there is none, the site keeps its built in photos |
| Videos / Reels | Shown with their cover image and a "Reel" tag; tapping opens Instagram |

**If the feed ever stops updating** (for example the owner changed the Instagram password,
which cancels the token): repeat Part 1 step 3 to get a new token, then run
`npx wrangler secret put IG_TOKEN` and
`npx wrangler kv key delete token --binding IG --remote` so the Worker picks up the new one.
