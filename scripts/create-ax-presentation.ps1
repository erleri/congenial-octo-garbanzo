$ErrorActionPreference = 'Stop'

if ($PSScriptRoot) {
  $root = Split-Path -Parent $PSScriptRoot
} else {
  $root = (Get-Location).Path
}

$out = Join-Path $root 'LatamFX_AX_5min_presentation.pptx'
$dashboardImg = Join-Path $root 'LatamFX_screen_dashboard.png'
$planImg = Join-Path $root 'LatamFX_screen_plan.png'
$monthlyImg = Join-Path $root 'LatamFX_screen_monthly.png'
$dailyImg = Join-Path $root 'LatamFX_screen_daily.png'
$adminImg = Join-Path $root 'LatamFX_screen_admin.png'

$ppt = New-Object -ComObject PowerPoint.Application
$ppt.Visible = [Microsoft.Office.Core.MsoTriState]::msoTrue
$pres = $ppt.Presentations.Add([Microsoft.Office.Core.MsoTriState]::msoTrue)
$pres.PageSetup.SlideWidth = 960
$pres.PageSetup.SlideHeight = 540

$blank = 12
$msoFalse = [Microsoft.Office.Core.MsoTriState]::msoFalse
$msoTrue = [Microsoft.Office.Core.MsoTriState]::msoTrue

function Convert-HexColor([string]$hex) {
  return [Convert]::ToInt32($hex.Substring(4, 2) + $hex.Substring(2, 2) + $hex.Substring(0, 2), 16)
}

function Add-Text(
  $slide,
  [string]$text,
  [float]$x,
  [float]$y,
  [float]$w,
  [float]$h,
  [int]$size,
  [string]$color = '172033',
  [bool]$bold = $false,
  [int]$align = 1
) {
  $shape = $slide.Shapes.AddTextbox(1, $x, $y, $w, $h)
  $shape.TextFrame.TextRange.Text = $text
  $shape.TextFrame.TextRange.Font.Name = 'Malgun Gothic'
  $shape.TextFrame.TextRange.Font.Size = $size
  $shape.TextFrame.TextRange.Font.Color.RGB = Convert-HexColor $color
  $shape.TextFrame.TextRange.ParagraphFormat.Alignment = $align
  if ($bold) {
    $shape.TextFrame.TextRange.Font.Bold = $msoTrue
  }
  $shape.TextFrame.MarginLeft = 0
  $shape.TextFrame.MarginRight = 0
  $shape.TextFrame.MarginTop = 0
  $shape.TextFrame.MarginBottom = 0
  return $shape
}

function Add-Background($slide, [string]$color = 'F6F3EC') {
  $slide.FollowMasterBackground = $msoFalse
  $slide.Background.Fill.Solid()
  $slide.Background.Fill.ForeColor.RGB = Convert-HexColor $color
}

function Add-SectionNumber($slide, [string]$number, [string]$label = 'AX CASE STUDY') {
  Add-Text $slide $number 54 30 35 24 12 '24736B' $true | Out-Null
  Add-Text $slide $label 92 30 180 24 10 '697386' $true | Out-Null
}

function Add-Title($slide, [string]$title, [string]$sub = '') {
  Add-Text $slide $title 54 65 850 54 27 '172033' $true | Out-Null
  if ($sub) {
    Add-Text $slide $sub 56 121 835 31 12 '697386' $false | Out-Null
  }
}

function Add-Pill($slide, [string]$text, [float]$x, [float]$y, [float]$w, [string]$fill = '24736B', [string]$font = 'FFFFFF') {
  $shape = $slide.Shapes.AddShape(5, $x, $y, $w, 28)
  $shape.Fill.ForeColor.RGB = Convert-HexColor $fill
  $shape.Line.Visible = $msoFalse
  $shape.TextFrame.TextRange.Text = $text
  $shape.TextFrame.TextRange.Font.Name = 'Malgun Gothic'
  $shape.TextFrame.TextRange.Font.Size = 10
  $shape.TextFrame.TextRange.Font.Bold = $msoTrue
  $shape.TextFrame.TextRange.Font.Color.RGB = Convert-HexColor $font
  $shape.TextFrame.TextRange.ParagraphFormat.Alignment = 2
  $shape.TextFrame.VerticalAnchor = 3
  return $shape
}

function Add-Card(
  $slide,
  [string]$title,
  [string]$body,
  [float]$x,
  [float]$y,
  [float]$w,
  [float]$h,
  [string]$accent = '24736B',
  [int]$bodySize = 13
) {
  $card = $slide.Shapes.AddShape(5, $x, $y, $w, $h)
  $card.Fill.ForeColor.RGB = Convert-HexColor 'FFFFFF'
  $card.Line.ForeColor.RGB = Convert-HexColor 'D9D7CF'
  $card.Line.Weight = 1
  $bar = $slide.Shapes.AddShape(1, $x, $y, 6, $h)
  $bar.Fill.ForeColor.RGB = Convert-HexColor $accent
  $bar.Line.Visible = $msoFalse
  Add-Text $slide $title ($x + 20) ($y + 15) ($w - 36) 27 16 '172033' $true | Out-Null
  Add-Text $slide $body ($x + 20) ($y + 49) ($w - 36) ($h - 58) $bodySize '4D586A' $false | Out-Null
}

function Add-FlowBox($slide, [string]$text, [float]$x, [float]$y, [float]$w, [string]$fill, [string]$font = 'FFFFFF') {
  $shape = $slide.Shapes.AddShape(5, $x, $y, $w, 52)
  $shape.Fill.ForeColor.RGB = Convert-HexColor $fill
  $shape.Line.Visible = $msoFalse
  $shape.TextFrame.TextRange.Text = $text
  $shape.TextFrame.TextRange.Font.Name = 'Malgun Gothic'
  $shape.TextFrame.TextRange.Font.Size = 14
  $shape.TextFrame.TextRange.Font.Bold = $msoTrue
  $shape.TextFrame.TextRange.Font.Color.RGB = Convert-HexColor $font
  $shape.TextFrame.TextRange.ParagraphFormat.Alignment = 2
  $shape.TextFrame.VerticalAnchor = 3
}

function Add-Arrow($slide, [float]$x1, [float]$y1, [float]$x2, [float]$y2, [string]$color = 'A3A9B3') {
  $line = $slide.Shapes.AddLine($x1, $y1, $x2, $y2)
  $line.Line.ForeColor.RGB = Convert-HexColor $color
  $line.Line.Weight = 2
  $line.Line.EndArrowheadStyle = 3
}

function Add-LabeledArrow(
  $slide,
  [float]$x1,
  [float]$y1,
  [float]$x2,
  [float]$y2,
  [string]$label,
  [float]$labelX,
  [float]$labelY,
  [float]$labelW,
  [string]$color = '98A2B3',
  [bool]$both = $false
) {
  $line = $slide.Shapes.AddLine($x1, $y1, $x2, $y2)
  $line.Line.ForeColor.RGB = Convert-HexColor $color
  $line.Line.Weight = 2
  $line.Line.EndArrowheadStyle = 3
  if ($both) {
    $line.Line.BeginArrowheadStyle = 3
  }
  $tag = $slide.Shapes.AddShape(5, $labelX, $labelY, $labelW, 20)
  $tag.Fill.ForeColor.RGB = Convert-HexColor 'F6F3EC'
  $tag.Line.Visible = $msoFalse
  $tag.TextFrame.TextRange.Text = $label
  $tag.TextFrame.TextRange.Font.Name = 'Malgun Gothic'
  $tag.TextFrame.TextRange.Font.Size = 9
  $tag.TextFrame.TextRange.Font.Bold = $msoTrue
  $tag.TextFrame.TextRange.Font.Color.RGB = Convert-HexColor '697386'
  $tag.TextFrame.TextRange.ParagraphFormat.Alignment = 2
  $tag.TextFrame.VerticalAnchor = 3
}

function Add-RoleNode(
  $slide,
  [string]$title,
  [string]$body,
  [float]$x,
  [float]$y,
  [float]$w,
  [float]$h,
  [string]$accent = '24736B',
  [bool]$center = $false
) {
  $fillColor = 'FFFFFF'
  $lineColor = 'D9D7CF'
  $titleColor = '172033'
  $bodyColor = '4D586A'
  if ($center) {
    $fillColor = '172033'
    $lineColor = '172033'
    $titleColor = 'FFFFFF'
    $bodyColor = 'DCE4EA'
  }
  $node = $slide.Shapes.AddShape(5, $x, $y, $w, $h)
  $node.Fill.ForeColor.RGB = Convert-HexColor $fillColor
  $node.Line.ForeColor.RGB = Convert-HexColor $lineColor
  $node.Line.Weight = 1.25
  if (-not $center) {
    $bar = $slide.Shapes.AddShape(1, $x, $y, 6, $h)
    $bar.Fill.ForeColor.RGB = Convert-HexColor $accent
    $bar.Line.Visible = $msoFalse
  }
  Add-Text $slide $title ($x + 16) ($y + 13) ($w - 32) 26 15 $titleColor $true 2 | Out-Null
  Add-Text $slide $body ($x + 14) ($y + 42) ($w - 28) ($h - 49) 10 $bodyColor $false 2 | Out-Null
}

function Add-ScreenImage($slide, [string]$path, [float]$x, [float]$y, [float]$w, [float]$h) {
  if (Test-Path $path) {
    $frame = $slide.Shapes.AddShape(5, ($x - 5), ($y - 5), ($w + 10), ($h + 10))
    $frame.Fill.ForeColor.RGB = Convert-HexColor 'FFFFFF'
    $frame.Line.ForeColor.RGB = Convert-HexColor 'D9D7CF'
    $frame.Shadow.Visible = $msoTrue
    $pic = $slide.Shapes.AddPicture($path, $msoFalse, $msoTrue, $x, $y, $w, $h)
    return $pic
  }
}

function Add-Footer($slide, [string]$text) {
  Add-Text $slide $text 56 505 650 18 9 '8A919E' $false | Out-Null
}

# 1. Cover
$s = $pres.Slides.Add(1, $blank)
Add-Background $s 'F6F3EC'
Add-Pill $s 'AX CASE STUDY · 10~12분' 58 48 160 '24736B' | Out-Null
Add-Text $s '환율 사이트를 만들며 배운' 58 122 610 48 25 '4D586A' $false | Out-Null
Add-Text $s 'AX의 실제' 58 170 610 82 48 '172033' $true | Out-Null
Add-Text $s '무엇을 만들었는가보다, 현업의 일을 어떻게 바꿨는가' 61 274 620 42 20 '24736B' $true | Out-Null
$quote = $s.Shapes.AddShape(5, 58, 344, 720, 92)
$quote.Fill.ForeColor.RGB = Convert-HexColor 'FFFFFF'
$quote.Line.Visible = $msoFalse
Add-Text $s '“AX는 현업의 반복 업무와 판단·공유 방식을 다시 설계하는 일입니다.”' 82 370 670 48 19 '172033' $true | Out-Null
Add-Text $s 'LatamFX는 주인공이 아니라, 이 생각을 검증한 사례입니다.' 60 466 600 22 11 '697386' $false | Out-Null

# 2. Pain
$s = $pres.Slides.Add(2, $blank)
Add-Background $s
Add-SectionNumber $s '01'
Add-Title $s '출발점은 AI가 아니라 현업의 불편이었다' '기술을 먼저 고르지 않고, 사람이 매일 붙잡혀 있는 흐름을 먼저 본다'
$steps = @(
  @{ t = '검색'; c = '355F8A' },
  @{ t = '계산'; c = '3D7287' },
  @{ t = '비교'; c = '24736B' },
  @{ t = '판단'; c = 'A56A3A' },
  @{ t = '공유'; c = '765C7D' }
)
$x = 65
foreach ($step in $steps) {
  Add-FlowBox $s $step.t $x 190 135 $step.c
  if ($x -lt 700) { Add-Arrow $s ($x + 138) 216 ($x + 165) 216 }
  $x += 170
}
Add-Card $s '반복의 비용' '각 단계는 어렵지 않지만 매일 쌓이고, 숫자 이동 과정에서 오류가 생깁니다.' 65 302 250 125 'A56A3A' 13
Add-Card $s '판단의 편차' '사람마다 비교 기준과 주목하는 통화가 달라 같은 데이터로 다른 대화를 할 수 있습니다.' 355 302 250 125 '765C7D' 13
Add-Card $s 'AX의 첫 질문' '“AI로 무엇을 할까?”보다 “어떤 반복이 중요한 판단을 방해하는가?”' 645 302 250 125 '24736B' 13
Add-Footer $s 'LatamFX AX 사례 · 문제 정의'

# 3. Vibe coding
$s = $pres.Slides.Add(3, $blank)
Add-Background $s
Add-SectionNumber $s '02'
Add-Title $s '바이브 코딩은 목적이 아니라 빠른 실험 수단이다' '자연어로 요구를 설명하고 AI와 대화하며 작동하는 시제품을 빠르게 만든다'
Add-Card $s 'AI가 잘하는 일' "코드 초안 만들기`r시제품 속도 높이기`r수정안을 빠르게 반복하기" 70 175 245 210 '24736B' 16
Add-Card $s '사람이 책임질 일' "문제 정의하기`r데이터와 계산 검증하기`r업무 적용 여부 판단하기" 357 175 245 210 'A56A3A' 16
Add-Card $s '바이브 코딩의 가치' '완성품을 단번에 만드는 것이 아니라, 가설을 싸게 시험하고 틀린 부분을 빨리 발견하는 것' 644 175 245 210 '765C7D' 15
Add-Text $s '속도 ≠ 신뢰성' 290 428 380 38 25 '172033' $true 2 | Out-Null
Add-Text $s '빠르게 만들수록 검증 기준과 책임은 더 명확해야 합니다.' 215 470 530 24 13 '697386' $false 2 | Out-Null
Add-Footer $s 'LatamFX AX 사례 · 바이브 코딩의 역할'

# 4. Transformation + demo
$s = $pres.Slides.Add(4, $blank)
Add-Background $s
Add-SectionNumber $s '03'
Add-Title $s 'LatamFX는 이렇게 업무를 바꿨다' '기능의 수보다, 사용자가 어떤 판단으로 더 빨리 이동했는가'
Add-ScreenImage $s $dashboardImg 55 168 520 325 | Out-Null
Add-Pill $s '시연은 60초 이내' 615 163 132 'A56A3A' | Out-Null
Add-Card $s '1 · MoM' '최근 방향이 강세인지 약세인지' 615 207 290 72 '355F8A' 12
Add-Card $s '2 · 52주 위치' '오늘 숫자가 1년 중 높은지 낮은지' 615 292 290 72 '24736B' 12
Add-Card $s '3 · 계획 대비' '시장 움직임을 회사의 계획과 연결' 615 377 290 72 '765C7D' 12
Add-Text $s '검색과 계산에서 → “무엇을 먼저 볼까?”로' 614 465 300 26 14 '172033' $true | Out-Null

# 5. Connected system map
$s = $pres.Slides.Add(5, $blank)
Add-Background $s
Add-SectionNumber $s '04'
Add-Title $s 'LatamFX를 움직이는 연결 구조' '화면 하나가 아니라, 각 역할이 이어져 하나의 업무 흐름을 만든다'

# Draw connections first so nodes remain visually on top.
Add-LabeledArrow $s 135 238 135 282 '환율 제공' 145 249 72 '355F8A'
Add-LabeledArrow $s 390 202 225 307 '매일 자동 실행' 267 231 92 '3D7287'
Add-LabeledArrow $s 570 202 735 212 '코드 배포' 615 181 72 '24736B'
Add-LabeledArrow $s 735 244 590 290 '웹사이트 제공' 627 254 90 '24736B'
Add-LabeledArrow $s 225 337 365 438 '환율 계산·적재' 244 374 100 '765C7D'
Add-LabeledArrow $s 478 414 478 356 '환율·계획 조회' 491 370 100 '765C7D' $true
Add-LabeledArrow $s 545 449 590 449 '데이터 조회' 536 390 82 'A56A3A'
Add-LabeledArrow $s 745 449 780 449 '메일 전달' 725 390 70 'A56A3A'
Add-LabeledArrow $s 590 330 780 430 '화면 확인' 665 358 70 '24736B'

Add-RoleNode $s '환율 제공처' '원천 환율 제공' 45 170 180 68 '355F8A'
Add-RoleNode $s 'GitHub Actions' '매일 수집·계산·DB 갱신' 45 282 180 78 '3D7287'
Add-RoleNode $s 'GitHub' '앱 코드·자동화 설정 보관' 390 165 180 75 '355F8A'
Add-RoleNode $s 'Netlify' '앱을 웹사이트로 자동 배포' 735 175 180 75 '24736B'
Add-RoleNode $s 'LatamFX' '환율을 비교하고 판단하기 쉽게 보여주는 업무 화면' 365 270 225 86 '24736B' $true
Add-RoleNode $s 'Supabase' '환율·계획 데이터와 권한 관리' 365 414 180 68 '765C7D'
Add-RoleNode $s '이메일 리포트' '같은 환율 정보를 자동 전달' 590 414 155 68 'A56A3A'
Add-RoleNode $s '현업 사용자' '웹·메일 확인 후 판단' 780 414 150 68 '24736B'
Add-Footer $s 'LatamFX AX 사례 · 데이터 수집 → 계산·저장 → 배포 → 확인·전달'

# 6. Four conditions
$s = $pres.Slides.Add(6, $blank)
Add-Background $s
Add-SectionNumber $s '05'
Add-Title $s '만들면서 발견한 AX의 네 가지 조건' '시제품이 실제 업무가 되려면 네 요소가 함께 맞아야 한다'
Add-Card $s '문제' '화면 하나가 아니라 입력부터 판단과 공유까지 전체 업무 흐름을 본다.' 60 170 200 220 '355F8A' 14
Add-Card $s '데이터' '출처와 정확성뿐 아니라 누락과 갱신 실패를 어떻게 발견할지 정한다.' 273 170 200 220 '24736B' 14
Add-Card $s '판단' '모든 숫자를 보여주기보다 무엇을 먼저 보고 어떻게 비교할지 설계한다.' 486 170 200 220 'A56A3A' 14
Add-Card $s '운영' '담당자, 권한, 배포, 장애 대응과 유지보수 책임을 정한다.' 699 170 200 220 '765C7D' 14
Add-Text $s '문제 × 데이터 × 판단 × 운영 = 실제로 쓰이는 AX' 154 432 650 40 24 '172033' $true 2 | Out-Null
Add-Footer $s 'LatamFX AX 사례 · 프로토타입에서 업무로'

# 7. Company process
$s = $pres.Slides.Add(7, $blank)
Add-Background $s
Add-SectionNumber $s '06'
Add-Title $s '회사에서 AX는 이렇게 진행되어야 한다' '큰 전략을 한 번에 완성하기보다 작은 검증을 운영 가능한 변화로 키운다'
$process = @(
  @{ n = '1'; t = '문제 정의'; b = "작고 구체적인`r현업 문제 선택"; c = '355F8A' },
  @{ n = '2'; t = '작은 실험'; b = "최소 기능으로`r빠르게 시제품 제작"; c = '3D7287' },
  @{ n = '3'; t = '현업 검증'; b = "실제 사용자와`r예외·오류 발견"; c = '24736B' },
  @{ n = '4'; t = '효과 측정'; b = "시간·오류·판단`r속도로 성과 확인"; c = 'A56A3A' },
  @{ n = '5'; t = '운영·확산'; b = "보안·권한·책임을`r붙여 검증 과제 확산"; c = '765C7D' }
)
$x = 43
foreach ($item in $process) {
  $circle = $s.Shapes.AddShape(9, ($x + 57), 177, 38, 38)
  $circle.Fill.ForeColor.RGB = Convert-HexColor $item.c
  $circle.Line.Visible = $msoFalse
  $circle.TextFrame.TextRange.Text = $item.n
  $circle.TextFrame.TextRange.Font.Name = 'Malgun Gothic'
  $circle.TextFrame.TextRange.Font.Size = 15
  $circle.TextFrame.TextRange.Font.Bold = $msoTrue
  $circle.TextFrame.TextRange.Font.Color.RGB = Convert-HexColor 'FFFFFF'
  $circle.TextFrame.TextRange.ParagraphFormat.Alignment = 2
  $circle.TextFrame.VerticalAnchor = 3
  Add-Card $s $item.t $item.b $x 225 152 150 $item.c 13
  if ($x -lt 700) { Add-Arrow $s ($x + 154) 298 ($x + 187) 298 }
  $x += 184
}
Add-Text $s '“AI를 사용했다”가 아니라, 업무가 실제로 얼마나 좋아졌는가를 측정합니다.' 125 425 710 42 19 '172033' $true 2 | Out-Null
Add-Footer $s 'LatamFX AX 사례 · 조직의 실행 방식'

# 8. Closing
$s = $pres.Slides.Add(8, $blank)
Add-Background $s '172033'
Add-Pill $s 'FROM PERSONAL EXPERIMENT TO ORGANIZATIONAL AX' 58 48 305 '24736B' | Out-Null
Add-Text $s '모든 직원이 개발자가 될 필요는 없습니다.' 58 119 760 50 27 'FFFFFF' $true | Out-Null
Add-Text $s "하지만 자신의 업무를 구조적으로 설명하고,`r작은 실험으로 개선 가능성을 확인하는 능력은 필요합니다." 60 185 760 80 21 'DCE4EA' $false | Out-Null
Add-Card $s '현업의 역할' '반복과 오류가 생기는 지점을 설명하고, 실제 업무에서 시제품을 검증한다.' 60 300 250 125 '3D7287' 13
Add-Card $s '조직의 역할' '데이터 접근, 보안 기준, 운영 책임을 제공하고 검증된 사례를 확산한다.' 355 300 250 125 '24736B' 13
Add-Card $s 'AX의 시작' '당연하게 반복하던 한 가지 업무를 다시 질문한다.' 650 300 250 125 'A56A3A' 13
Add-Text $s '“AX의 시작은 거대한 AI 전략이 아니라, 오늘도 반복되는 한 가지 업무를 다시 묻는 것입니다.”' 70 468 820 35 16 'FFFFFF' $true 2 | Out-Null

# Appendix A
$s = $pres.Slides.Add(9, $blank)
Add-Background $s
Add-Pill $s 'Q&A APPENDIX' 54 30 105 '697386' | Out-Null
Add-Title $s '데이터와 기술 구조' '질문이 있을 때만 설명하는 운영 구조'
Add-FlowBox $s '환율 API / 보정 데이터' 70 185 175 '355F8A'
Add-Arrow $s 250 211 290 211
Add-FlowBox $s '수집·계산·DB 적재' 295 185 150 '3D7287'
Add-Arrow $s 450 211 490 211
Add-FlowBox $s 'Supabase 저장·조회' 495 185 150 '24736B'
Add-Arrow $s 650 211 690 211
Add-FlowBox $s '화면·메일 확인' 695 185 150 '765C7D'
Add-Card $s '화면' "React + TypeScript`rNetlify 배포" 105 310 210 110 '355F8A' 14
Add-Card $s '환율·계획 데이터' "Supabase Database + Auth`r조회와 권한별 수정" 375 310 210 110 '24736B' 14
Add-Card $s '운영 자동화' "GitHub Actions`r정기 수집·검증·적재" 645 310 210 110 '765C7D' 14

# Appendix B
$s = $pres.Slides.Add(10, $blank)
Add-Background $s
Add-Pill $s 'Q&A APPENDIX' 54 30 105 '697386' | Out-Null
Add-Title $s '현재 구현 범위' '현재 기능과 운영 전 확인 사항을 구분한다'
Add-ScreenImage $s $planImg 55 165 430 270 | Out-Null
Add-Card $s '현재 구현됨' "환율 수집·보정`r주요 지표 계산`r월별·일별 추이`r계획 대비 비교`r메일 본문·차트 생성" 535 165 340 185 '24736B' 14
Add-Card $s '운영 전 확인' "수신자 체계`r장애 알림`r담당자와 유지보수 책임" 535 370 340 115 'A56A3A' 14

# Appendix C
$s = $pres.Slides.Add(11, $blank)
Add-Background $s
Add-Pill $s 'Q&A APPENDIX' 54 30 105 '697386' | Out-Null
Add-Title $s '향후 AI 분석 방향' '현재 구현 기능이 아니라, 검증 이후 확장할 수 있는 가능성'
Add-Card $s '이상 통화 요약' 'MoM, 52주 위치, 계획 대비 차이가 큰 통화를 우선 제안' 65 175 250 170 '355F8A' 14
Add-Card $s '원인 후보 연결' '환율 움직임과 외부 시장 정보를 연결해 검토할 맥락 제시' 355 175 250 170 '24736B' 14
Add-Card $s '대응 질문 제안' '결론을 확정하기보다 회의에서 확인해야 할 질문과 근거 제안' 645 175 250 170 '765C7D' 14
Add-Text $s 'AI의 역할: 판단을 대체하는 결론 → 판단을 돕는 근거와 검토 대상' 130 405 700 45 21 '172033' $true 2 | Out-Null

# Appendix D
$s = $pres.Slides.Add(12, $blank)
Add-Background $s
Add-Pill $s 'Q&A APPENDIX' 54 30 105 '697386' | Out-Null
Add-Title $s '기능 화면' '필요한 질문에 맞춰 월별·일별·계획·관리 화면을 보여준다'
Add-ScreenImage $s $monthlyImg 55 160 260 163 | Out-Null
Add-ScreenImage $s $dailyImg 350 160 260 163 | Out-Null
Add-ScreenImage $s $adminImg 645 160 260 163 | Out-Null
Add-Card $s '월별·일별 추이' '단기 변화와 장기 흐름을 분리해 확인' 55 355 260 100 '355F8A' 13
Add-Card $s '계획 대비' '실제 환율을 회사의 계획 기준과 연결' 350 355 260 100 '24736B' 13
Add-Card $s '관리·운영' '데이터 상태, 업로드와 운영 정보를 확인' 645 355 260 100 '765C7D' 13

if (Test-Path $out) {
  Remove-Item -LiteralPath $out -Force
}

$pres.SaveAs($out)
$pres.Close()
$ppt.Quit()
[System.Runtime.InteropServices.Marshal]::ReleaseComObject($pres) | Out-Null
[System.Runtime.InteropServices.Marshal]::ReleaseComObject($ppt) | Out-Null
Write-Output $out
