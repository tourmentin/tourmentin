# Outil ponctuel pour la mesure avant/après du 12.3.1 : à lancer dans un
# terminal séparé, en même temps que harnais.mjs ou harnais-avant-12-3-1.mjs.
# Échantillonne les processus chrome.exe et le débit réseau, puis affiche le
# pic de processus, le pic de mémoire et le débit moyen à la fin.
#
# Usage : .\mesurer-ressources.ps1 -DureeSecondes 600
param(
    [Parameter(Mandatory = $true)]
    [int]$DureeSecondes,
    [int]$IntervalleSecondes = 5
)

$picProcessus = 0
$picMemoireMo = 0
$echantillonsReseau = @()

# Get-Counter avec l'ensemble "Network Interface" échoue sur certaines
# machines (compteurs de performance non enregistrés, absents en anglais).
# Get-NetAdapterStatistics ne dépend pas de PDH : on calcule le débit
# nous-mêmes par différence d'octets entre deux échantillons.
$adaptateursExclus = "isatap|Loopback|Teredo"
$dernierEchantillonReseau = Get-NetAdapterStatistics | Where-Object { $_.Name -notmatch $adaptateursExclus }
$dernierHorodatage = Get-Date

$debut = Get-Date
$fin = $debut.AddSeconds($DureeSecondes)
Write-Host "Mesure démarrée pour $DureeSecondes s, échantillon toutes les $IntervalleSecondes s..."

while ((Get-Date) -lt $fin) {
    $procs = Get-Process chrome -ErrorAction SilentlyContinue
    $nbProcessus = ($procs | Measure-Object).Count
    $memoireMo = if ($procs) { [math]::Round(($procs | Measure-Object WorkingSet64 -Sum).Sum / 1MB, 1) } else { 0 }
    if ($nbProcessus -gt $picProcessus) { $picProcessus = $nbProcessus }
    if ($memoireMo -gt $picMemoireMo) { $picMemoireMo = $memoireMo }

    $maintenant = Get-Date
    $mbitS = 0
    try {
        $echantillonReseau = Get-NetAdapterStatistics -ErrorAction Stop | Where-Object { $_.Name -notmatch $adaptateursExclus }
        $secoulees = ($maintenant - $dernierHorodatage).TotalSeconds
        $totalOctetsAvant = ($dernierEchantillonReseau | Measure-Object -Property ReceivedBytes, SentBytes -Sum | Measure-Object -Property Sum -Sum).Sum
        $totalOctetsApres = ($echantillonReseau | Measure-Object -Property ReceivedBytes, SentBytes -Sum | Measure-Object -Property Sum -Sum).Sum
        if ($secoulees -gt 0) {
            $mbitS = [math]::Round((($totalOctetsApres - $totalOctetsAvant) * 8) / $secoulees / 1MB, 2)
        }
        $dernierEchantillonReseau = $echantillonReseau
        $dernierHorodatage = $maintenant
        $echantillonsReseau += $mbitS
    } catch {
        # Aucun adaptateur trouvé ou API indisponible : on garde 0 pour cet
        # échantillon plutôt que d'arrêter la mesure.
    }

    Write-Host ("  {0}  processus={1}  mémoire={2} Mo  réseau={3} Mbit/s" -f (Get-Date -Format "HH:mm:ss"), $nbProcessus, $memoireMo, $mbitS)
    Start-Sleep -Seconds $IntervalleSecondes
}

$reseauMoyen = if ($echantillonsReseau.Count -gt 0) { [math]::Round(($echantillonsReseau | Measure-Object -Average).Average, 2) } else { 0 }

Write-Host ""
Write-Host "--- Résumé ---"
Write-Host ("Durée mesurée      : {0} s" -f $DureeSecondes)
Write-Host ("Processus au pic   : {0}" -f $picProcessus)
Write-Host ("Mémoire au pic     : {0} Mo" -f $picMemoireMo)
Write-Host ("Débit réseau moyen : {0} Mbit/s" -f $reseauMoyen)
