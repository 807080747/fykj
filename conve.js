const fetch = require('node-fetch');
const fs = require('fs');

// =========源列表，已经删掉空url条目=========
const SOURCE_LIST = [
  {
    url: "https://seep.eu.org/https://raw.githubusercontent.com/djshxjsh233/migu/refs/heads/main/live.txt"
  },
  {
    url: "http://iptv.910501.xyz/"
  },
  {
    url: "http://wangziduoqing.cn/yuan/zb.txt"
  }
];

const GLOBAL_TIMEOUT = 20000;
// 单个播放链接探测超时 3000ms
const CHECK_STREAM_TIMEOUT = 3000;
// 最大并发探测数量，不要调大，防止限流
const MAX_CHECK_CONCURRENT = 8;

const adKeywords = ["广告", "购物", "付费", "商城", "游戏推广", "财经广告", "弹窗", "TG频道"];
const vodKeywords = ["小品","相声","电影","电视剧","综艺","动漫","纪录片","短剧","点播","合集"];

/**
 * 探测单个播放链接是否http可达，HEAD请求，不下载视频内容
 */
async function checkStreamUrl(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CHECK_STREAM_TIMEOUT);
  try {
    const res = await fetch(url, {
      method: "HEAD",
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: controller.signal
    });
    clearTimeout(timer);
    return res.ok;
  } catch (e) {
    clearTimeout(timer);
    return false;
  }
}

/**
 * 简单并发队列控制
 */
async function limitedMap(list, limit, asyncFn) {
  const results = [];
  const executing = [];
  for(const item of list){
    const p = Promise.resolve().then(()=>asyncFn(item));
    results.push(p);
    if(limit <= list.length){
      const e = p.then(()=>executing.splice(executing.indexOf(e),1));
      executing.push(e);
      if(executing.length >= limit){
        await Promise.race(executing);
      }
    }
  }
  return await Promise.all(results);
}

function pushRawChannel(name, url, group, rawLiveList, rawVodList){
  const isAd = adKeywords.some(word => name.includes(word) || group.includes(word));
  const isVod = vodKeywords.some(word => name.includes(word));
  const u = url.trim();
  const invalidUrl = !u.startsWith("http") || u.length === 0;
  if(isAd || invalidUrl) return;

  if(isVod){
    rawVodList.push({name, url:u, group});
  }else{
    rawLiveList.push({name, url:u, group});
  }
}

async function run() {
  let rawLiveList = [];
  let rawVodList = [];

  for (const source of SOURCE_LIST) {
    const sourceUrl = source.url;
    console.log(`\n=====正在读取源：${sourceUrl}=====`);
    console.log(`⏱️全局超时设置：${GLOBAL_TIMEOUT/1000}秒`);
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
          pushRawChannel(cName,cUrl,nowGroup,rawLiveList,rawVodList);
          continue;
        }
        if (rawLine.startsWith("http")) {
          pushRawChannel(channelName,rawLine,nowGroup,rawLiveList,rawVodList);
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

  console.log(`\n🔍开始检测直播源有效性，待检测：${rawLiveList.length} 个`);
  // 对直播做可用性检测
  const liveCheckRes = await limitedMap(rawLiveList, MAX_CHECK_CONCURRENT, async (ch)=>{
    const ok = await checkStreamUrl(ch.url);
    return {...ch, ok};
  });
  const validLive = liveCheckRes.filter(x=>x.ok);
  console.log(`✅检测完成，有效直播频道：${validLive.length}`);

  console.log(`🔍开始检测点播源有效性，待检测：${rawVodList.length} 个`);
  const vodCheckRes = await limitedMap(rawVodList, MAX_CHECK_CONCURRENT, async (ch)=>{
    const ok = await checkStreamUrl(ch.url);
    return {...ch, ok};
  });
  const validVod = vodCheckRes.filter(x=>x.ok);
  console.log(`✅检测完成，有效点播条目：${validVod.length}`);

  // 组装输出live.txt
  const groupDone = new Set();
  let liveText = "";
  for(const ch of validLive){
    if(ch.group === "未分组"){
      liveText += `${ch.name},${ch.url}\n`;
    }else{
      if(!groupDone.has(ch.group)){
        liveText += `${ch.group},#genre#\n`;
        groupDone.add(ch.group);
      }
      liveText += `${ch.name},${ch.url}\n`;
    }
  }
  fs.writeFileSync("./live.txt", liveText, "utf8");

  // 组装输出vod.txt
  let vodText = "";
  for(const ch of validVod){
    vodText += `${ch.name},${ch.url}\n`;
  }
  fs.writeFileSync("./vod.txt", vodText, "utf8");

  console.log("\n🎉全部处理完毕，输出 live.txt vod.txt");
}

run();
