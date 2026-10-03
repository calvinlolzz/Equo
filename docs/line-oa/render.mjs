// Renders the HTML sources to the JPEGs that get uploaded in LINE OA Manager.
//   node render.mjs            -> avatar, cover, richmenu, link-hero
//   node render.mjs menu cover -> only the named sources
// Output goes next to the sources (menu.html -> richmenu.jpg); link-hero.html goes to apps/web/public/assets/line/.
import { fileURLToPath } from "node:url";
import { chromium } from "file:///C:/Users/wukec/AppData/Local/npm-cache/_npx/31e32ef8478fbf80/node_modules/playwright/index.mjs";

const TARGETS = {
  avatar: { out: "avatar", w: 1024, h: 1024 },
  cover: { out: "cover", w: 1600, h: 800 },
  menu: { out: "richmenu", w: 2500, h: 1686 },
  // The LINE link card hero is served by the app itself, so it renders straight into apps/web/public.
  "link-hero": { out: "../../apps/web/public/assets/line/link-hero-v1", w: 1024, h: 512 },
};
const wanted = process.argv.slice(2);
const names = wanted.length ? wanted : Object.keys(TARGETS);

const b = await chromium.launch({ executablePath: "C:/Users/wukec/AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe" });
for (const n of names) {
  const t = TARGETS[n];
  if (!t) throw new Error(`unknown target: ${n}`);
  const p = await b.newPage({ viewport: { width: t.w, height: t.h } });
  await p.goto(new URL(`./${n}.html`, import.meta.url).href);
  await p.waitForTimeout(400);
  await p.screenshot({ path: fileURLToPath(new URL(`./${t.out}.jpg`, import.meta.url)), type: "jpeg", quality: n === "link-hero" ? 85 : 92 });
  await p.close();
  console.log("rendered", t.out + ".jpg");
}
await b.close();
