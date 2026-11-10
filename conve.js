const fetch = require('node-fetch');
const fs = require('fs');

// =====================配置区=====================
const SOURCE_LIST = [
  {
    url: "http://1.94.31.214/live/live9/dgtv.txt"
  },
  {
    url: "http://iptv.910501.xyz/"
  },
  {
    url: "http://wangziduoqing.cn/yuan/zb.txt"
  }
];

const GLOBAL_TIMEOUT = 20000;

const adKeywords = ["广告", "购物", "付费", "商城", "游戏推广", "财经广告", "弹窗", "TG频道"];
const blackListKeywords = ["测试", "失效", "演示", "备用源", "广告台"];
const priorityGroups = ["央视", "央视频道", "卫视频道", "卫视"];
// =================================================

function getCctvNum(name) {
  const m = name.match(/CCTV[‑‑](\d+)/i);
  if (m) return parseInt(m[1], 10);
  return null;
}

function channelNameSort(a, b) {
  const na = getCctvNum(a.name);
  const nb = getCctvNum(b.name);
  if (na !== null && nb !== null) {
    return na - nb;
  }
  return a.name.localeCompare(b.name, 'zh-CN', { numeric: true, sensitivity: 'base' });
}

function cleanChannelName(name) {
  return name
    .replace(/[◆★■●▶▷【】〖〗「」『』《》♫♪]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function pushRawChannel(name, url, group, rawLiveList) {
  const cleanName = cleanChannelName(name);
  const u = url.trim();
  const invalidUrl = !u.startsWith("http") || u.length === 0;

  const isAd = adKeywords.some(w => cleanName.includes(w) || group.includes(w));
  const isBlack = blackListKeywords.some(w => cleanName.includes(w));

  if (isAd || isBlack || invalidUrl) return;

  rawLiveList.push({ name: cleanName, url: u, group });
}

async function run() {
  let rawLiveList = [];

  for (const source of SOURCE_LIST) {
    const sourceUrl = source.url;
    console.log(`\n=====正在读取源：${sourceUrl}=====`);
    console.log(`⏱️全局超时设置：${GLOBAL_TIMEOUT / 1000}秒`);
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), GLOBAL_TIMEOUT);
      const res = await fetch(sourceUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0",
          "Cache-Control": "no-cache, no-store, must-revalidate",
          "Pragma": "no-cache",
          "Expires": "0"
        },
        signal: controller.signal
      });
      clearTimeout(timer);
      if (!res.ok) {
        console.log(`❌访问源失败，状态码:${res.status}`);
        continue;
      }
      const content = await res.text();
      console.log(`✅读取源成功，文件长度：${content.length}`);
      const lines = content.split(/\r?\n/);
      let nowGroup = "未分组";
      let channelName = "未知频道";

      for (const line of lines) {
        const rawLine = line.trim();
        if (!rawLine) continue;
        if (rawLine.startsWith("#EXTINF:")) {
          const gMatch = rawLine.match(/group-title="([^"]+)"/);
          if (gMatch) nowGroup = gMatch[1].trim();
          const nMatch = rawLine.match(/,(.*)$/);
          if (nMatch && nMatch[1].trim()) {
            channelName = nMatch[1].trim();
          } else {
            channelName = "未知频道";
          }
          continue;
        }
        if (rawLine.endsWith(",#genre#")) {
          nowGroup = rawLine.split(',')[0].trim();
          channelName = "未知频道";
          continue;
        }
        if (rawLine.includes(',') && !rawLine.startsWith("#")) {
          const parts = rawLine.split(',');
          const cName = parts[0].trim() || "未知频道";
          const cUrl = parts[1].trim();
          pushRawChannel(cName, cUrl, nowGroup, rawLiveList);
          continue;
        }
        if (rawLine.startsWith("http")) {
          pushRawChannel(channelName, rawLine, nowGroup, rawLiveList);
        }
      }
    } catch (err) {
      if (err.name === "AbortError") {
        console.error(`⏱️源读取超时：${sourceUrl}`);
      } else {
        console.error(`❌源读取异常：${sourceUrl}，${err.message}`);
      }
    }
  }

  const validLive = rawLiveList;
  console.log(`✅不做存活检测，全部保留，频道总数：${validLive.length}`);

  const groupsAll = [...new Set(validLive.map(i => i.group))];
  const priority = groupsAll.filter(g => priorityGroups.some(p => g.includes(p)));
  const otherGroups = groupsAll.filter(g => !priorityGroups.some(p => g.includes(p)));
  const finalGroupOrder = [...priority, ...otherGroups];

  //输出 live.txt
  let liveText = "";
  for (const g of finalGroupOrder) {
    const list = validLive.filter(x => x.group === g).sort(channelNameSort);
    if (g !== "未分组") liveText += `${g},#genre#\n`;
    for (const ch of list) liveText += `${ch.name},${ch.url}\n`;
  }
  fs.writeFileSync("./live.txt", liveText, "utf8");

  //输出 live.m3u
  let m3u = "#EXTM3U\n";
  for (const g of finalGroupOrder) {
    const list = validLive.filter(x => x.group === g).sort(channelNameSort);
    for (const ch of list) {
      m3u += `#EXTINF:-1 group-title="${g}",${ch.name}\n${ch.url}\n`;
    }
  }
  fs.writeFileSync("./live.m3u", m3u, "utf8");

  console.log("\n🎉全部处理完毕｜关闭链接探测，不会误删台");
  console.log(`📺直播:${validLive.length}`);
}

run();
