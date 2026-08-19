# AmbiCrew 桌面端发布流程

发布新版本时，按下面两步操作。

## 1. 更新版本号（4 处，必须保持一致）

| 文件 | 字段 |
|---|---|
| `desktop/package.json` | `"version": "x.y.z"` |
| `desktop/src-tauri/tauri.conf.json` | `"version": "x.y.z"` |
| `desktop/src-tauri/Cargo.toml` | `version = "x.y.z"` |
| `desktop/src-tauri/Cargo.lock` | `ambicrew` 包的 `version = "x.y.z"` |

## 2. 编译

```bash
cd client/desktop
npm run build:all      # 前端 + server sidecar + adapter sidecar（自动把版本号 bake 进二进制）
npm run tauri:build    # Rust 编译 + NSIS 打包
```

## 3. 产物

最终交付文件（安装包）：

```
src-tauri/target/release/bundle/nsis/AmbiCrew_<版本>_x64-setup.exe
```

中间产物（打包的输入，不用管）：`src-tauri/target/release/ambicrew.exe`。

## 说明

- 版本号由 `build-sidecars.ts` / `build-server.ts` 读取 `tauri.conf.json` 的 `version` 自动 bake 进 sidecar 二进制，只需改上面 4 处，无需手动改 sidecar。
- `tauri.conf.json` 的 `bundle.targets = "nsis"`，只打 NSIS 安装包，跳过 MSI。
- 构建耗时：Rust 首次编译约 6 分钟，之后增量编译更快。
- 验证：编译日志里应依次出现 `Baking version x.y.z`、`Compiling ambicrew vx.y.z`、产物文件名含版本号。
