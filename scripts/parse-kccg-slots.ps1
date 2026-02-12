param(
    [Parameter(Mandatory = $true)]
    [string]$PdfUrl,

    [Parameter(Mandatory = $false)]
    [string]$ReportDate = (Get-Date -Format "dd.MM.yyyy"),

    [Parameter(Mandatory = $false)]
    [string]$OutDir = ".",

    [Parameter(Mandatory = $false)]
    [string]$BaseName = ""
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($BaseName)) {
    $safeDate = $ReportDate -replace "\.", "-"
    $BaseName = "kccg_slots_$safeDate"
}

if (-not (Test-Path -LiteralPath $OutDir)) {
    New-Item -ItemType Directory -Path $OutDir | Out-Null
}

$tmpPath = Join-Path $OutDir "__kccg_pdf_extract_tmp.txt"
$extractUrl = "https://r.jina.ai/http://$PdfUrl"

try {
    curl.exe -L $extractUrl -o $tmpPath | Out-Null
} catch {
    throw "Failed to fetch parsed PDF text via r.jina.ai. URL: $PdfUrl"
}

$text = Get-Content $tmpPath -Raw
$idx = $text.IndexOf("Markdown Content:")
if ($idx -ge 0) {
    $text = $text.Substring($idx + "Markdown Content:".Length)
}

$lines = $text -split "`r?`n" |
    ForEach-Object { $_.Trim() } |
    Where-Object { $_ -ne "" }

$records = @()
$currentSection = ""
$current = $null

function Clean-Name([string]$s) {
    if ([string]::IsNullOrWhiteSpace($s)) { return $s }
    $n = $s -replace "\s+111111\s+Ljekar specijalista u amb\..*$", ""
    $n = $n -replace "\s+", " "
    return $n.Trim()
}

function Flush-Record {
    param([ref]$current, [ref]$records, [string]$section, [string]$reportDate, [string]$pdfUrl)

    if ($null -eq $current.Value) { return }

    $block = ($current.Value.Lines -join " ")
    $block = $block -replace "\s+", " "

    $hasNoSlots = $block -match "Nema slobodnih termina"
    $dates = @([regex]::Matches($block, "\d{2}\.\d{2}\.\d{4}\.\s*\d{2}:\d{2}") |
        ForEach-Object { $_.Value -replace "\s+", " " })

    $firstSlot = $null
    if (-not $hasNoSlots) {
        if ($dates.Count -ge 2) { $firstSlot = $dates[1] }
        elseif ($dates.Count -ge 1) { $firstSlot = $dates[0] }
    }

    $name = Clean-Name $current.Value.Name
    if ([string]::IsNullOrWhiteSpace($name)) {
        $m = [regex]::Match($block, "^\d{6}\s+(.+?)\s+111111\s+Ljekar specijalista u amb\.")
        if ($m.Success) { $name = Clean-Name $m.Groups[1].Value }
    }

    $records.Value += [pscustomobject]@{
        section         = $section
        code            = $current.Value.Code
        specialist      = $name
        status          = if ($hasNoSlots) { "NO_SLOTS" } else { "HAS_SLOTS" }
        first_available = $firstSlot
        last_booked     = if ($dates.Count -ge 1) { $dates[0] } else { $null }
        source_pdf_date = $reportDate
        source_pdf_url  = $pdfUrl
    }

    $current.Value = $null
}

foreach ($line in $lines) {
    if ($line -match "^#\s*\d+\s*-\s*(.+)$") {
        Flush-Record -current ([ref]$current) -records ([ref]$records) -section $currentSection -reportDate $ReportDate -pdfUrl $PdfUrl
        $currentSection = ($matches[1] -replace "\s+", " ").Trim()
        continue
    }

    if ($line -match "^Strana\s+\d+\s+od\s+\d+" -or
        $line -match "^#\s*Klini" -or
        $line -match "^Prvi slobodni termin$" -or
        $line -match "^Datum Ambulanta") {
        continue
    }

    if ($line -match "^(\d{6})\s+(.+)$") {
        $code = $matches[1]

        # 111111 is a doctor placeholder in row details, not a new record key.
        if ($code -eq "111111" -and $null -ne $current) {
            $current.Lines += $line
            continue
        }

        Flush-Record -current ([ref]$current) -records ([ref]$records) -section $currentSection -reportDate $ReportDate -pdfUrl $PdfUrl
        $current = [pscustomobject]@{
            Code  = $code
            Name  = $matches[2]
            Lines = @($line)
        }
        continue
    }

    if ($null -ne $current) {
        $current.Lines += $line
    }
}

Flush-Record -current ([ref]$current) -records ([ref]$records) -section $currentSection -reportDate $ReportDate -pdfUrl $PdfUrl

$records = $records | Where-Object { -not [string]::IsNullOrWhiteSpace($_.specialist) }

# Deduplicate exact parser duplicates while preserving first occurrence.
$dedup = @{}
$clean = foreach ($r in $records) {
    $k = "$($r.section)|$($r.code)|$($r.specialist)|$($r.status)|$($r.first_available)|$($r.last_booked)"
    if (-not $dedup.ContainsKey($k)) {
        $dedup[$k] = $true
        $r
    }
}

$allPath = Join-Path $OutDir "$BaseName`_normalized.csv"
$hasPath = Join-Path $OutDir "$BaseName`_has_slots.csv"
$noPath = Join-Path $OutDir "$BaseName`_no_slots.csv"
$bySpecPath = Join-Path $OutDir "$BaseName`_by_specialist.csv"
$jsonPath = Join-Path $OutDir "$BaseName`_normalized.json"

$clean |
    Sort-Object section, specialist |
    Export-Csv $allPath -NoTypeInformation -Encoding utf8

$clean |
    Where-Object { $_.status -eq "HAS_SLOTS" } |
    Sort-Object { [datetime]::ParseExact($_.first_available, "dd.MM.yyyy. HH:mm", $null) } |
    Export-Csv $hasPath -NoTypeInformation -Encoding utf8

$clean |
    Where-Object { $_.status -eq "NO_SLOTS" } |
    Sort-Object section, specialist |
    Export-Csv $noPath -NoTypeInformation -Encoding utf8

$grouped = $clean | Group-Object section, specialist
$bySpecialist = foreach ($g in $grouped) {
    $items = @($g.Group)
    $slotItems = @($items | Where-Object { $_.status -eq "HAS_SLOTS" })
    $hasSlots = $slotItems.Count -gt 0
    $first = $null
    if ($hasSlots) {
        $first = ($slotItems |
            Sort-Object { [datetime]::ParseExact($_.first_available, "dd.MM.yyyy. HH:mm", $null) } |
            Select-Object -First 1).first_available
    }

    [pscustomobject]@{
        section         = $items[0].section
        specialist      = $items[0].specialist
        status          = if ($hasSlots) { "HAS_SLOTS" } else { "NO_SLOTS" }
        first_available = $first
        codes           = (($items.code | Sort-Object -Unique) -join "|")
        variants        = $items.Count
        source_pdf_date = $ReportDate
        source_pdf_url  = $PdfUrl
    }
}

$bySpecialist |
    Sort-Object status, section, specialist |
    Export-Csv $bySpecPath -NoTypeInformation -Encoding utf8

$clean | ConvertTo-Json -Depth 4 | Set-Content $jsonPath -Encoding utf8

Remove-Item -LiteralPath $tmpPath -ErrorAction SilentlyContinue

$hasCount = (@($clean | Where-Object { $_.status -eq "HAS_SLOTS" })).Count
$noCount = (@($clean | Where-Object { $_.status -eq "NO_SLOTS" })).Count

Write-Output "Done. Rows: $($clean.Count). HAS_SLOTS: $hasCount. NO_SLOTS: $noCount."
Write-Output "Files:"
Write-Output " - $allPath"
Write-Output " - $hasPath"
Write-Output " - $noPath"
Write-Output " - $bySpecPath"
Write-Output " - $jsonPath"
