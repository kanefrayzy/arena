param(
  [string]$Host_ = "178.105.23.83",
  [string]$User = "root",
  [string]$Old = "gp9iEqMjJnJb4mt7FKRC",
  [string]$New = "Arena!Strong#2026_Secure_Pass_92xK"
)

$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = "plink.exe"
$psi.Arguments = "-ssh -batch -pw `"$Old`" $User@$Host_ `"echo OK`""
$psi.UseShellExecute = $false
$psi.RedirectStandardInput = $true
$psi.RedirectStandardOutput = $true
$psi.RedirectStandardError = $true
$psi.CreateNoWindow = $true

$proc = [System.Diagnostics.Process]::Start($psi)

# Background readers so output is consumed and prompt advances.
$outBuf = New-Object System.Text.StringBuilder
$errBuf = New-Object System.Text.StringBuilder
$outAction = { if ($EventArgs.Data) { [void]$Event.MessageData.AppendLine($EventArgs.Data); Write-Host $EventArgs.Data } }
Register-ObjectEvent -InputObject $proc -EventName OutputDataReceived -Action $outAction -MessageData $outBuf | Out-Null
Register-ObjectEvent -InputObject $proc -EventName ErrorDataReceived -Action $outAction -MessageData $errBuf | Out-Null
$proc.BeginOutputReadLine()
$proc.BeginErrorReadLine()

Start-Sleep -Seconds 3
$proc.StandardInput.WriteLine($Old)
Start-Sleep -Seconds 2
$proc.StandardInput.WriteLine($New)
Start-Sleep -Seconds 2
$proc.StandardInput.WriteLine($New)
Start-Sleep -Seconds 2
$proc.StandardInput.Close()

if (-not $proc.WaitForExit(60000)) { $proc.Kill(); throw "timeout" }
Write-Host "EXIT: $($proc.ExitCode)"
