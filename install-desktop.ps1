<#
.SYNOPSIS
  把 dsh-skill-sidebar（技能侧边栏）安装 / 升级 / 卸载到 DeepSeek Harness **桌面版**的 desktop profile。

.DESCRIPTION
  桌面版把插件装进 $DSH_HOME/profiles/desktop，这个 profile 由 Electron 独占管理：
  全局 `dsh` CLI 会拒绝操作它（"profile desktop is managed exclusively by the
  Electron application"）。因此本脚本调用**桌面安装自带的 CLI 载体**
  （app.asar 内的 dsh-desktop-host/lib/cli.js，带 manageDesktopProfile 权限）。

  两条安装途径：
    1) 应用正在运行 —— 用应用内的插件管理（设置 → 插件，或让 DSH 助手用 plugin_manager
       工具安装），**无需重启**：宿主会热重组并让页面按需加载新 bundle。
       本次安装即走这条路（link 到本仓库）。
    2) 应用已完全退出 —— 运行本脚本（-Mode Link 指向本仓库做开发安装，-Mode Tarball 分发）。

  装好后在桌面版里的位置：右侧边栏 → 标签页「技能」（图标为技能图标）；
  新会话会自动打开一次；也可从右栏「开始」指南页的「技能」胶囊进入。

  参数：
    -Mode Link      安装为 link:<仓库路径>（默认），改代码即生效（重启应用后加载），适合开发。
    -Mode Tarball   从 <仓库路径>\dsh-skill-sidebar-<版本>.tgz 安装，适合分发。
    -Repo           仓库绝对路径，默认取本脚本所在目录。
    -Uninstall      改为卸载。
    -WhatIf         只打印将执行的命令，不实际执行。

.EXAMPLE
  pwsh -File .\install-desktop.ps1
  pwsh -File .\install-desktop.ps1 -Mode Tarball
  pwsh -File .\install-desktop.ps1 -Uninstall
#>
[CmdletBinding()]
param(
  [ValidateSet('Link', 'Tarball')][string]$Mode = 'Link',
  [string]$Repo,
  [switch]$Uninstall,
  [switch]$WhatIf
)

$ErrorActionPreference = 'Stop'

if (-not $Repo) { $Repo = $PSScriptRoot }
$Repo = (Resolve-Path -LiteralPath $Repo).Path

$dshHome = if ($env:DSH_HOME -and $env:DSH_HOME.Trim()) { $env:DSH_HOME.Trim() } else { Join-Path $HOME '.dsh' }
$desktopProfile = Join-Path $dshHome 'profiles\desktop'

# 桌面安装位置：常见安装目录（Where-Object 只命中一个时返回标量，必须 @() 归一为数组）
$candidates = @(
  (Join-Path $env:LOCALAPPDATA 'Programs\DeepSeek Harness'),
  'D:\Program Files\DeepSeek Harness'
) | Where-Object { $_ -and (Test-Path (Join-Path $_ 'DeepSeek Harness.exe')) }
$candidates = @($candidates)

if ($candidates.Count -eq 0) {
  throw "找不到 DeepSeek Harness 安装目录。请确认已安装桌面版，或改用应用内插件管理安装。"
}
$installDir = $candidates[0]
$exe = Join-Path $installDir 'DeepSeek Harness.exe'
$asar = Join-Path $installDir 'resources\app.asar'
$cliHost = Join-Path $asar 'dsh\node_modules\@deepseek-ai\dsh-desktop-host\lib\cli.js'

if (-not (Test-Path $desktopProfile)) {
  throw "桌面 profile 不存在：$desktopProfile —— 请先启动一次桌面版再运行本脚本。"
}
# 注意：$cliHost 位于 app.asar 归档内部，PowerShell 看不到归档内部路径，
# 只能检查归档文件本身；归档内的模块解析由 Electron 运行时负责。
if (-not (Test-Path $asar)) {
  throw "桌面安装内未找到运行时归档：$asar（安装版本可能过旧）。"
}

# 1) 目标 spec
if ($Uninstall) {
  $spec = 'dsh-skill-sidebar'
  $pnpmArgs = @('plugin', '--profile', 'desktop', 'remove', $spec)
} elseif ($Mode -eq 'Tarball') {
  $version = (Get-Content (Join-Path $Repo 'package.json') -Raw | ConvertFrom-Json).version
  $tgz = Join-Path $Repo "dsh-skill-sidebar-$version.tgz"
  if (-not (Test-Path $tgz)) { throw "未找到 $tgz —— 先在仓库目录执行 npm pack。" }
  $spec = $tgz
  $pnpmArgs = @('plugin', '--profile', 'desktop', 'add', $spec)
} else {
  $spec = "link:$Repo"
  $pnpmArgs = @('plugin', '--profile', 'desktop', 'add', $spec)
}

Write-Host "桌面安装        : $installDir"
Write-Host "desktop profile : $desktopProfile"
Write-Host "操作            : $($pnpmArgs -join ' ')" -ForegroundColor Cyan

if ($WhatIf) { Write-Host "(-WhatIf) 未执行。" -ForegroundColor Yellow; return }

# 2) 运行中检测：应用运行时 profile 的 package.json 被宿主接管，CLI 会等待并可能失败
$running = Get-Process -Name 'DeepSeek Harness' -ErrorAction SilentlyContinue
if ($running) {
  Write-Warning "检测到桌面版正在运行。CLI 安装需要独占 profile/package.json，请先完全退出桌面版；"
  Write-Warning "若不想退出，请改用应用内插件管理安装（设置 → 插件，或让 DSH 助手用 plugin_manager 安装）——那条路不需要重启。"
  $answer = Read-Host "已完全退出请按 Enter 继续，输入 n 取消"
  if ($answer -eq 'n') { Write-Host "已取消。"; return }
}

# 3) 用桌面自带的 CLI 载体执行（manageDesktopProfile = true）
#    注意：DeepSeek Harness.exe 是 GUI 子系统程序，用 `&` 调用不会等待也不回传退出码，
#    必须用 Start-Process -Wait；且 Start-Process 不会自动为含空格的参数加引号，需自行处理。
function Quote-Arg([string]$value) {
  if ($value -match '\s') { return '"' + $value + '"' }
  return $value
}

$argList = @('--expose-internals', (Quote-Arg $cliHost)) + ($pnpmArgs | ForEach-Object { Quote-Arg $_ })
$env:ELECTRON_RUN_AS_NODE = '1'
try {
  $proc = Start-Process -FilePath $exe -ArgumentList $argList -NoNewWindow -Wait -PassThru
  $code = $proc.ExitCode
} finally {
  Remove-Item Env:\ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
}

if ($code -ne 0) { throw "安装失败，退出码 $code（诊断见 $desktopProfile\.plugin-manager\logs）" }

if (-not $Uninstall) {
  # 4) 冒烟检查：desktop profile 的 package.json 必须登记该依赖
  $manifest = Get-Content (Join-Path $desktopProfile 'package.json') -Raw | ConvertFrom-Json
  $listed = $manifest.dependencies.PSObject.Properties.Name -contains 'dsh-skill-sidebar'
  if ($listed) {
    Write-Host "已登记到 desktop profile：$($manifest.dependencies.'dsh-skill-sidebar')" -ForegroundColor Green
  } else {
    Write-Warning "profile 的 package.json 里没有看到 dsh-skill-sidebar —— 请检查上面的 CLI 输出。"
  }
}

Write-Host ""
if ($Uninstall) {
  Write-Host "已卸载。重启桌面版后右侧边栏的「技能」标签页消失。" -ForegroundColor Green
} else {
  Write-Host "完成。启动桌面版后：" -ForegroundColor Green
  Write-Host "  · 右侧边栏出现「技能」标签页（新会话自动打开一次）"
  Write-Host "  · 右栏「开始」指南页里也有「技能」胶囊入口"
  Write-Host "  · 列表底部显示运行外壳（桌面版 / 浏览器）与技能来源，便于确认已生效"
}
