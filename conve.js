const fetch = require('node-fetch');
const fs = require('fs');

// =========在这里添加所有源，txt、m3u都支持=========
const SOURCE_LIST = [
  {
    url: "http://iptv.910501.xyz/"
  },
  {
    url: "https://nb.xymm.de5.net/0ybmli/https://iptv.445569.xyz/live.m3u"
  },
  {
    url: "http://1.94.31.214/live/live9/dgtv.txt"
  },
  {
    url: "https://gh-proxy.com/https://raw.githubusercontent.com/807080747/Collect-IPTV/refs/heads/main/best_sorted.m3u"
  },
  {
    url: "https://16097.kstore.space/xiang/migu.txt"
  }
];

// 全局统一超时：15秒
const GLOBAL_TIMEOUT = 15000;
// 广告关键词过滤
const adKeywords = ["广告", "购物", "付费", "商城", "游戏推广", "财经广告", "弹窗", "TG频道"];

// 全局存储解析后的频道 {name,url,group}
let allChannelList = [];

/**
 * 加入频道，做广告、url合法性过滤
 */
function pushChannel(name, url, group) {
  const n = (name || "未知频道").trim();
  const u = (url || "").trim();
  const g = (group || "未分组").trim();

  const isAd = adKeywords.some(word => n.includes(word) || g.includes(word));
  const invalidUrl = !u.startsWith("http");
  if (isAd || invalidUrl) return;

  allChannelList.push({ name: n, url: u, group: g });
}

async function run() {
  allChannelList = [];

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
        console.log(`❌访问失败，状态码:${res.status}`);
        continue;
      }
      const content = await res.text();
      console.log(`✅读取成功，文件长度：${content.length}`);
      const lines = content.split(/\r?\n/);

      let nowGroup = "未分组";
      let channelName = "未知频道";
      let sourceCount = 0;

      for (const line of lines) {
        // 清除每行内的 \r 回车字符
        const rawLine = line.replace(/\r/g, '').trim();
        if (!rawLine) continue;

        // ---------------- M3U解析逻辑 ----------------
        // #EXTINF 信息行
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

        // ---------------- TXT解析逻辑 ----------------
        // tvbox分组标记
        if (rawLine.endsWith(",#genre#")) {
          nowGroup = rawLine.split(',')[0].trim();
          channelName = "未知频道";
          continue;
        }

        // txt格式 频道名,url 取最后一个逗号分割，兼容名字带逗号
        if (rawLine.includes(',') && !rawLine.startsWith("#")) {
          const lastCommaIndex = rawLine.lastIndexOf(',');
          const cName = rawLine.substring(0, lastCommaIndex).trim() || "未知频道";
          const cUrl = rawLine.substring(lastCommaIndex + 1).trim();
          pushChannel(cName, cUrl, nowGroup);
          sourceCount++;
          continue;
        }

        // m3u播放地址行（http链接，用上一行#EXTINF得到的频道名）
        if (rawLine.startsWith("http")) {
          pushChannel(channelName, rawLine, nowGroup);
          sourceCount++;
        }
      }
      console.log(`📌本源解析得到频道：${sourceCount}`);
    } catch (err) {
      if (err.name === "AbortError") {
        console.error(`⏱️读取超时：${sourceUrl}`);
      } else {
        console.error(`❌读取源出错：${sourceUrl}，${err.message}`);
      }
    }
  }

  console.log(`\n🎉全部解析完成，总频道：${allChannelList.length}`);

  // 输出 TVBox 标准 live.txt
  const usedGroup = new Set();
  let txtOut = `#更新时间：${new Date().toLocaleString('zh-CN')}\n`;

  for (const ch of allChannelList) {
    if (ch.group !== "未分组" && !usedGroup.has(ch.group)) {
      txtOut += `${ch.group},#genre#\n`;
      usedGroup.add(ch.group);
    }
    txtOut += `${ch.name},${ch.url}\n`;
  }

  fs.writeFileSync("./live.txt", txtOut, "utf8");
  console.log("✅输出完成 → live.txt (仅TVBox txt格式)");
}

run();
