# 奶迹 Naiji

奶迹是一款面向新手爸妈的宝宝喂奶记录助手。本仓库当前包含可安装到主屏幕的 PWA 手机网页端，以及产品 PRD、交互原型和示例导出文件。

## 本地预览

```bash
cd pwa
python3 -m http.server 4173
```

然后访问：

```text
http://127.0.0.1:4173/index.html
```

## 目录

- `pwa/`：PWA 线上版本
- `pwa/index.html`：高保真交互页面
- `pwa/manifest.webmanifest`：PWA 安装配置
- `pwa/service-worker.js`：离线缓存
- `feeding-record-miniapp-prd.md`：小程序方向 PRD
- `naiji-pwa-prd.md`：PWA 方向 PRD
- `naiji-interactive-prototype.html`：原始高保真交互原型
- `naiji-feeding-sample.csv`：CSV 导出样例

## 部署

项目可直接部署到 Vercel。根目录下的 `vercel.json` 会将访问请求转发到 `pwa/` 目录。
