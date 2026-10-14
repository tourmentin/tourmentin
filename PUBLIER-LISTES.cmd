@echo off
chcp 65001 >nul
setlocal
rem Signature des listes publiees (spec 14.33 A, 14.39 point 3). A lancer par double-clic APRES avoir telecharge
rem l'export du back-office (menu Export). La cle est lue dans %USERPROFILE%\Tourmentin-cle\ ; rien n'est envoye nulle part.
rem Variables facultatives : TOURMENTIN_DOSSIER_CLE et TOURMENTIN_DOSSIER_PUBLICATION (par defaut : le dossier de l'utilisateur).
cd /d "%~dp0listes"
set "DOSSIER_CLE=%USERPROFILE%\Tourmentin-cle"
if defined TOURMENTIN_DOSSIER_CLE set "DOSSIER_CLE=%TOURMENTIN_DOSSIER_CLE%"
set "CLE=%DOSSIER_CLE%\cle-listes.json"
set "SORTIE=%USERPROFILE%\Tourmentin-publication"
if defined TOURMENTIN_DOSSIER_PUBLICATION set "SORTIE=%TOURMENTIN_DOSSIER_PUBLICATION%"
rem Variables reservees aux essais (cle jetable, dossier temporaire) : jamais definies en usage normal.
if defined TMT_CLE_ESSAI set "CLE=%TMT_CLE_ESSAI%"
if defined TMT_SORTIE_ESSAI set "SORTIE=%TMT_SORTIE_ESSAI%"
set "EXPORT=%~1"
if defined EXPORT goto controle
for /f "delims=" %%F in ('dir /b /o-d "%USERPROFILE%\Downloads\tourmentin-export-*.json" 2^>nul') do set "EXPORT=%USERPROFILE%\Downloads\%%F" & goto controle
echo Aucun fichier tourmentin-export-*.json dans votre dossier Téléchargements.
echo Téléchargez d'abord l'export dans le back-office, ou déposez le fichier sur PUBLIER-LISTES.cmd.
goto fin
:controle
if not exist "%EXPORT%" goto sansexport
if not exist "%CLE%" goto sanscle
echo Signature des listes publiées.
echo.
echo Fichier d'export utilisé :
echo   %EXPORT%
for %%I in ("%EXPORT%") do echo   date du fichier : %%~tI
echo.
echo Les différences avec la publication précédente vont s'afficher, puis une confirmation vous sera demandée,
echo puis votre phrase de passe, sans affichage à l'écran.
echo.
if not exist "%SORTIE%" mkdir "%SORTIE%"
node outils\publier.ts publier --export "%EXPORT%" --cle "%CLE%" --sortie "%SORTIE%"
if errorlevel 1 goto echec
echo.
echo Listes signées écrites dans %SORTIE%
echo Rien n'est encore publié : dites à Claude « listes signées » pour qu'il les vérifie et les dépose.
goto fin
:sansexport
echo Le fichier d'export est introuvable : %EXPORT%
goto fin
:sanscle
echo La clé est introuvable : %CLE%
echo Lancez d'abord CREER-CLE-LISTES.cmd.
goto fin
:echec
echo.
echo ÉCHEC : rien n'a été signé ni écrit.
:fin
echo.
pause
