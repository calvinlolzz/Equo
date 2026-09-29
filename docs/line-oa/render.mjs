import { chromium } from "file:///C:/Users/wukec/AppData/Local/npm-cache/_npx/31e32ef8478fbf80/node_modules/playwright/index.mjs";
const b = await chromium.launch({ executablePath: "C:/Users/wukec/AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe" });
for (const [n,w,h] of [["avatar",1024,1024],["cover",1600,800],["menu",2500,1686]]) {
  const p = await b.newPage({ viewport:{width:w,height:h} });
  await p.goto(new URL(`./${n}.html`, import.meta.url).href); await p.waitForTimeout(300);
  await p.screenshot({ path:`${n}.png` }); await p.close();
}
await b.close();
