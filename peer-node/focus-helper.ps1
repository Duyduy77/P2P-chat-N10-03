param(
    [string]$Action,
    [string]$Path
)

# Load Win32 API functions for focusing
$signature = @'
[DllImport("user32.dll")]
public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
[DllImport("user32.dll")]
public static extern bool SetForegroundWindow(IntPtr hWnd);
'@
$type = Add-Type -MemberDefinition $signature -Name "Win32Focus" -Namespace "Win32Focus" -PassThru

if ($Action -eq "open") {
    $p = Start-Process -FilePath $Path -PassThru -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 800

    $filename = [System.IO.Path]::GetFileName($Path)
    # Search by matching window title to filename or process ID
    $proc = Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and ($_.MainWindowTitle -like "*$filename*" -or $_.Id -eq $p.Id) } | Select-Object -First 1

    if ($proc) {
        $hwnd = $proc.MainWindowHandle
        # Minimize (6) then Restore/Show (9) then SetForeground to force activation
        [Win32Focus.Win32Focus]::ShowWindowAsync($hwnd, 6) > $null
        Start-Sleep -Milliseconds 100
        [Win32Focus.Win32Focus]::ShowWindowAsync($hwnd, 9) > $null
        [Win32Focus.Win32Focus]::SetForegroundWindow($hwnd) > $null
    }
}
elseif ($Action -eq "explore") {
    $folderPath = [System.IO.Path]::GetDirectoryName($Path)
    $folderName = [System.IO.Path]::GetFileName($folderPath)
    
    Start-Process explorer.exe -ArgumentList "/select,`"$Path`""
    Start-Sleep -Milliseconds 800

    # Find the Explorer process with window title matching folderName or folderPath
    $proc = Get-Process -Name explorer | Where-Object { $_.MainWindowHandle -ne 0 -and ($_.MainWindowTitle -like "*$folderName*" -or $_.MainWindowTitle -like "*$folderPath*") } | Select-Object -First 1

    if ($proc) {
        $hwnd = $proc.MainWindowHandle
        [Win32Focus.Win32Focus]::ShowWindowAsync($hwnd, 6) > $null
        Start-Sleep -Milliseconds 100
        [Win32Focus.Win32Focus]::ShowWindowAsync($hwnd, 9) > $null
        [Win32Focus.Win32Focus]::SetForegroundWindow($hwnd) > $null
    }
}
