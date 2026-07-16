@echo off
setlocal
set "APP=F:\CLAUDE\maxine-vfx-sdk\samples\VideoEffectsApp\VideoEffectsApp.exe"
set "MODELS=C:\Program Files\NVIDIA Corporation\NVIDIA Video Effects\models"
set "PATH=F:\CLAUDE\maxine-vfx-sdk\samples\external\opencv\bin;C:\Program Files\NVIDIA Corporation\NVIDIA Video Effects;%PATH%"

"%APP%" --in_file="%~1" --out_file="%~2" --effect=SuperRes --resolution=%~3 --mode=%~4 --strength=%~5 --model_dir="%MODELS%" --progress
exit /b %ERRORLEVEL%
