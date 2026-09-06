$ErrorActionPreference = 'Stop'

. "$PSScriptRoot/../modules/functions/Notifications.ps1"

function Assert-Equal {
    param ($Expected, $Actual, [string]$Message)
    if ($Expected -ne $Actual) {
        throw "$Message Expected '$Expected', got '$Actual'."
    }
}

function global:Write-Entry {
    param ($Message, $Subtext, $Path, $Color, $log)
}

function global:Start-Sleep {
    param ([int]$Seconds)
    $script:sleepDelays += $Seconds
}

$global:AgregarrTriggerEnabled = 'true'
$global:AgregarrUrl = 'http://agregarr:7171'
$global:AgregarrApiKey = 'test-key'
$global:configLogging = 'test.log'

$script:statusPlan = @(409, 429, 202)
$script:requestAttempts = 0
$script:sleepDelays = @()

function global:Invoke-RestMethod {
    param ($Method, $Uri, $Headers, $Body, $ContentType, $TimeoutSec, $ErrorAction)

    $status = $script:statusPlan[$script:requestAttempts]
    $script:requestAttempts++
    if ($status -eq 202) {
        return [pscustomobject]@{ queued = $true; deduplicated = $false }
    }

    $exception = [System.Exception]::new("HTTP $status")
    $exception | Add-Member -NotePropertyName Response -NotePropertyValue ([pscustomobject]@{
        StatusCode = $status
        Headers = [pscustomobject]@{
            RetryAfter = [pscustomobject]@{ Delta = [TimeSpan]::FromSeconds(1) }
        }
    })
    throw $exception
}

Send-AgregarrTrigger -RatingKey '123' -MediaType movie -Title 'Retry Test'
Assert-Equal 3 $script:requestAttempts 'Retryable 409/429 responses should be retried.'
Assert-Equal '1,1' ($script:sleepDelays -join ',') 'Retry-After delays should be honored.'

$script:statusPlan = @(403)
$script:requestAttempts = 0
$script:sleepDelays = @()
Send-AgregarrTrigger -RatingKey '124' -MediaType movie -Title 'Permanent Failure Test'
Assert-Equal 1 $script:requestAttempts 'A permanent 403 response must not be retried.'
Assert-Equal 0 $script:sleepDelays.Count 'A permanent 403 response must not sleep before returning.'

Write-Output 'Agregarr callback retry tests passed.'
