<div align="center">

<img src="https://capsule-render.vercel.app/api?type=waving&height=180&color=0:0B1F17,50:128C7E,100:25D366&text=IZUKU-MD&fontColor=ffffff&fontSize=72&fontAlignY=38&desc=A%20WhatsApp%20bot%20that%20deploys%20in%20minutes&descSize=18&descAlignY=60&animation=fadeIn" alt="IZUKU-MD banner" width="100%"/>

<img src="https://img.shields.io/github/forks/sera0x/IZUKU-MD?style=for-the-badge&label=forks&color=25D366" alt="forks"/> <img src="https://img.shields.io/github/stars/sera0x/IZUKU-MD?style=for-the-badge&label=stars&color=25D366" alt="stars"/>

<br/>

<a href="https://pair.dkit.name.ng"><img src="https://img.shields.io/badge/GET%20SESSION%20ID-25D366?style=for-the-badge&labelColor=0B1F17" alt="Get session ID" height="40"/></a> <a href="https://pair.dkit.name.ng/download"><img src="https://img.shields.io/badge/DOWNLOAD%20ZIP-128C7E?style=for-the-badge&labelColor=0B1F17" alt="Download zip" height="40"/></a> <a href="https://chat.whatsapp.com/IDrlKbb18zoEbdh4Xl4Bh2?s=cl&p=i&mlu=4&ilr=4&iam=2"><img src="https://img.shields.io/badge/SUPPORT%20GROUP-075E54?style=for-the-badge&labelColor=0B1F17" alt="Support group" height="40"/></a>

</div>

## How it works
Three steps, same on every host.

**Configuration**

Set two environment variables before the first start:
- `OWNER_NUMBER` — your WhatsApp number, country code first, digits only (e.g. `2348012345678`)
- `SESSION_ID` — the single-use id from the pairing site (`IZUKU-XXXXXXXXXXXX`)

That's it. Everything else is optional.

## Pick your host

<div align="center">

<a href="https://heroku.com/deploy?template=https://github.com/sera0x/IZUKU-MD"><img src="https://img.shields.io/badge/DEPLOY%20TO%20HEROKU-430098?style=for-the-badge&logo=heroku&logoColor=white" alt="Deploy to Heroku" height="44"/></a> <a href="#render-free-tier"><img src="https://img.shields.io/badge/RENDER%20GUIDE-46E3B7?style=for-the-badge&logo=render&logoColor=black" alt="Render guide" height="44"/></a>

<a href="#terminal--vps"><img src="https://img.shields.io/badge/VPS%20GUIDE-25D366?style=for-the-badge&logo=gnubash&logoColor=white" alt="VPS guide" height="44"/></a> <a href="#panel"><img src="https://img.shields.io/badge/PANEL%20GUIDE-128C7E?style=for-the-badge&logoColor=white" alt="Panel guide" height="44"/></a>

</div>

## Terminal / VPS
```
git clone https://github.com/sera0x/IZUKU-MD
cd IZUKU-MD
cp .env.example .env   # set OWNER_NUMBER and SESSION_ID
npm install            # or bun install
npm start              # or bun index.js
```
Requires Node.js 20+. No bun needed, npm works the same.

## Heroku
1. Tap the Deploy to Heroku button above, it fills in the repo for you.
2. Set `OWNER_NUMBER` and `SESSION_ID` on the form, then tap Deploy.
3. After it builds, enable the worker dyno (Resources tab). Done.

## Render (free tier)
The one-click blueprint uses a paid plan, so do it manually on the free one:
1. Push the repo to your own GitHub (or fork it).
2. On render.com: New + > Web Service > connect your repo.
3. Runtime: Node. Build command: `npm install`. Start command: `npm start`.
   Instance type: Free.
4. Under Environment, add `OWNER_NUMBER` and `SESSION_ID` (from the pairing site).
5. Create Web Service. WhatsApp sessions are long-lived connections, so this
   works on the free plan only if the service stays awake; Render sleeps free
   services after inactivity, so ping the service URL every few minutes with an
   uptime monitor (UptimeRobot free tier) to keep the bot online.

## Panel
1. Download the zip above and upload it to your panel, or fork the repo.
2. Set the env vars: `OWNER_NUMBER`, `SESSION_ID` (from the pairing site).
3. Start command: `npm install && npm start`. Node 20 or newer.

## Troubleshooting
**Session id rejected** — ids are single-use and die if the linked device was
logged out. Pair again on the site for a fresh one.

**Connection loop / 403** — the number is blocked or rate-limited by WhatsApp.
Stop the bot, wait a few hours, pair once and leave it alone.

**Bot silent in groups** — by design. Run `.agb live` in the group to activate
cards, `.agb poke` for pokemon, `.agb gamble` for the casino.

Stuck? Ask in the support group.

<p align="center">
<a href="https://chat.whatsapp.com/IDrlKbb18zoEbdh4Xl4Bh2?s=cl&p=i&mlu=4&ilr=4&iam=2"><img src="https://img.shields.io/badge/JOIN%20THE%20WHATSAPP%20GROUP-25D366?style=for-the-badge&logo=whatsapp&logoColor=white" alt="Join the WhatsApp group" height="44"/></a>
</p>
