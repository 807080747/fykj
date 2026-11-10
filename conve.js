const fs = require('fs');
const fetch = require('node-fetch');

// 源列表，注释掉github容易超时的源
const SOURCE_LIST = [
  {
    url: "http://1.94.31.214/live/live9/dgtv.txt"
  },
  {
    url: "http://iptv.910501.xyz/"
  },
  // {
  //   url: "http://wangziduoqing.cn/yuan/zb.txt"
  // }
];

let channelList = [];

// 抓取单个源
async function fetchSource(item) {
  try {
    console.log(`正在抓取：${item.url}`);
    const res = await fetch(item.url, { timeout: 12000 });
    if (!res.ok) {
      console.log(`请求失败 ${item.url} status:${res.status}`);
      return;
    }
    const text = await res.text();
    parseText(text);
  } catch (err) {
    console.log(`抓取异常 ${item.url}`, err.message);
  }
}

// 解析txt内容 格式：频道名,url
function parseText(text) {
  const lines = text.split(/\r?\n/);
  for (let line of lines) {
    line = line.trim();
    if (!line || line.startsWith('#')) continue;
    const arr = line.split(',');
    if (arr.length < 2) continue;
    const name = arr[0].trim();
    const url = arr[1].trim();
    if (!name || !url) continue;
    channelList.push({ name, url, group: "默认分组" });
  }
}

// 主函数
async function main() {
  channelList = [];
  for (const s of SOURCE_LIST) {
    await fetchSource(s);
  }

  console.log(`一共解析到频道：${channelList.length} 个`);

  // 生成 txt
  let liveText = "";
  const updateTime = new Date().toLocaleString('zh‑CN');
  liveText += `#更新时间：${updateTime}\n`;

  for (const ch of channelList) {
    liveText += `${ch.name},${ch.url}\n`;
  }
  fs.writeFileSync("./live.txt", liveText, "utf8");

  // 生成 m3u
  let m3uText = `#EXTM3U\n#更新时间：${updateTime}\n`;
  for (const ch of channelList) {
    m3uText += `#EXT‑INF:-1,${ch.name}\n${ch.url}\n`;
  }
  fs.writeFileSync("./live.m3u", m3uText, "utf8");

  console.log("✅ 文件生成完成！");
}

main().catch(e => {
  console.error("脚本出错：", e);
  process.exit(1);
});
