@echo off
chcp 65001 >nul
setlocal
rem Creation de la cle de signature des listes (spec 14.33 C). A lancer par double-clic.
rem La cle privee est ecrite CHIFFREE dans %USERPROFILE%\Tourmentin-cle\ (hors depot), jamais ecrasee.
rem Variable facultative : TOURMENTIN_DOSSIER_CLE (autre dossier ; par defaut celui de l'utilisateur).
cd /d "%~dp0listes"
set "DOSSIER=%USERPROFILE%\Tourmentin-cle"
if defined TOURMENTIN_DOSSIER_CLE set "DOSSIER=%TOURMENTIN_DOSSIER_CLE%"
rem Variable reservee aux essais : un dossier temporaire a la place du vrai.
if defined TMT_DOSSIER_CLE_ESSAI set "DOSSIER=%TMT_DOSSIER_CLE_ESSAI%"
set "FICHIER=%DOSSIER%\cle-listes.json"
if exist "%FICHIER%" goto existe
if not exist "%DOSSIER%" mkdir "%DOSSIER%"
echo Creation de la cle de signature des listes.
echo La phrase de passe vous sera demandee deux fois, sans affichage a l'ecran.
echo.
node outils\publier.ts creer-cle "%FICHIER%"
if errorlevel 1 goto echec
echo.
echo Clé créée. Notez votre phrase de passe dans votre gestionnaire et copiez le dossier Tourmentin-cle en lieu sûr.
echo.
for /f "delims=" %%K in ('node outils\publier.ts cle-publique "%FICHIER%"') do echo Clé publique : %%K
goto fin
:existe
echo Une clé existe déjà dans %DOSSIER% : elle n'est jamais écrasée. Rien n'a été fait.
goto fin
:echec
echo.
echo ÉCHEC : aucune clé n'a été créée.
:fin
echo.
pause
