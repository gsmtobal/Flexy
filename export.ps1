$conn = New-Object System.Data.SqlClient.SqlConnection("Server=.\SQLEXPRESS;Database=SuperM_DB;Integrated Security=True")
$conn.Open()
$cmd = $conn.CreateCommand()
$cmd.CommandText = "SELECT * FROM Tcustumer"
$adapter = New-Object System.Data.SqlClient.SqlDataAdapter($cmd)
$dt = New-Object System.Data.DataTable
$adapter.Fill($dt) | Out-Null
$dt | ConvertTo-Json -Depth 10 | Out-File "data\clients_old.json" -Encoding UTF8

$cmd.CommandText = "SELECT * FROM TCarteRecharge"
$dt2 = New-Object System.Data.DataTable
$adapter.Fill($dt2) | Out-Null
$dt2 | ConvertTo-Json -Depth 10 | Out-File "data\cards_old.json" -Encoding UTF8

$conn.Close()
Write-Host "Export done"
