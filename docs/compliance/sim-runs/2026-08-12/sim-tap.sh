#!/usr/bin/env bash
# Tap a normalized point (0..1) on a named Simulator window.
#
# Usage:
#   sim-tap.sh --device "iPhone 17 Pro Max" --nx 0.5 --ny 0.55
#   sim-tap.sh --device "iPhone 17" --nx 0.5 --ny 0.4          # AX LCD if found
#   sim-tap.sh --device "iPhone 17" --ax --nx 0.5 --ny 0.4     # fail if no LCD
#   sim-tap.sh --device "iPhone 17 Pro Max" --no-ax --nx 0.5 --ny 0.96
#
# Coordinate source:
#   --no-ax  → title-bar insets only (legacy Pro Max path; 32/18/8).
#   --ax     → System Events AX of the device screen / "LCD" (fail if missing).
#   default  → AX LCD if it looks like a phone screen, else insets.
#              Inset fallback keeps Pro Max taps valid when AX is empty/wrong.
#
# iPhone 17 (2026-08-12): content is the AXGroup at ~350×760 (window origin
# 437,113 on one layout). Guessed 32/18/8 insets miss that frame.
set -euo pipefail
DEVICE="iPhone 17 Pro Max"
NX=""
NY=""
AX_MODE="auto" # auto | require | off
while [[ $# -gt 0 ]]; do
  case "$1" in
    --device) DEVICE="$2"; shift 2 ;;
    --nx) NX="$2"; shift 2 ;;
    --ny) NY="$2"; shift 2 ;;
    --ax) AX_MODE="require"; shift ;;
    --no-ax) AX_MODE="off"; shift ;;
    -h|--help)
      sed -n '2,18p' "$0"
      exit 0
      ;;
    *) echo "unknown $1" >&2; exit 2 ;;
  esac
done
if [[ -z "$NX" || -z "$NY" ]]; then
  echo "need --nx and --ny" >&2
  exit 2
fi

# Returns: mode X Y W H
# mode is "ax" | "window" | "missing" | "none"
read -r MODE X Y W H < <(osascript - "$DEVICE" "$AX_MODE" <<'APPLESCRIPT'
on run argv
  set deviceName to item 1 of argv
  set axMode to item 2 of argv
  tell application "System Events"
    if not (exists process "Simulator") then return "none 0 0 0 0"
    tell process "Simulator"
      repeat with w in windows
        set wn to name of w as text
        -- Exact device token so "iPhone 17" does not steal "iPhone 17 Pro Max".
        -- Also matches Simulator "Clone N of <device> – iOS …" titles.
        set matched to false
        if deviceName is "iPhone 17" then
          if wn contains "iPhone 17" and wn does not contain "Pro" and wn does not contain "17e" then set matched to true
        else
          if wn contains deviceName then set matched to true
        end if
        if matched then
          set wp to position of w
          set ws to size of w
          set wx to item 1 of wp
          set wy to item 2 of wp
          set ww to item 1 of ws
          set wh to item 2 of ws
          if axMode is not "off" then
            set namedRect to ""
            set bestRect to ""
            set bestArea to 0
            set minArea to (ww * wh) * 0.4
            try
              set elems to entire contents of w
              repeat with el in elems
                set en to ""
                set ed to ""
                try
                  set en to (name of el) as text
                end try
                try
                  set ed to (description of el) as text
                end try
                try
                  set p to position of el
                  set s to size of el
                  set gx to item 1 of p
                  set gy to item 2 of p
                  set gw to item 1 of s
                  set gh to item 2 of s
                  if gw ≥ 200 and gh ≥ 400 then
                    set blob to en & " " & ed
                    if blob contains "LCD" or blob contains "lcd" then
                      set namedRect to (gx as integer as text) & " " & (gy as integer as text) & " " & (gw as integer as text) & " " & (gh as integer as text)
                    end if
                    set aspect to gh / gw
                    set area to gw * gh
                    set inside to (gx ≥ wx - 4) and (gy ≥ wy - 4) and ((gx + gw) ≤ (wx + ww + 4)) and ((gy + gh) ≤ (wy + wh + 4))
                    set smaller to (gw ≤ ww - 8) or (gh ≤ wh - 8)
                    if inside and smaller and aspect ≥ 1.5 and aspect ≤ 2.6 and area ≥ minArea and area > bestArea then
                      set bestArea to area
                      set bestRect to (gx as integer as text) & " " & (gy as integer as text) & " " & (gw as integer as text) & " " & (gh as integer as text)
                    end if
                  end if
                end try
              end repeat
            end try
            if namedRect is not "" then
              return "ax " & namedRect
            end if
            if bestRect is not "" then
              return "ax " & bestRect
            end if
            if axMode is "require" then
              return "missing 0 0 0 0"
            end if
          end if
          return "window " & (wx as integer as text) & " " & (wy as integer as text) & " " & (ww as integer as text) & " " & (wh as integer as text)
        end if
      end repeat
    end tell
  end tell
  return "none 0 0 0 0"
end run
APPLESCRIPT
)

if [[ "$MODE" == "none" || "$W" == "0" || -z "$W" ]]; then
  if [[ "$MODE" == "missing" ]]; then
    echo "FAIL: --ax set but no LCD/device-screen AXGroup in $DEVICE" >&2
  else
    echo "FAIL: no Simulator window matching $DEVICE" >&2
  fi
  exit 1
fi

if [[ "$MODE" == "ax" ]]; then
  CW=$W
  CH=$H
  CX=$(/usr/bin/python3 -c "print(int(round($X + $CW * $NX)))")
  CY=$(/usr/bin/python3 -c "print(int(round($Y + $CH * $NY)))")
  echo "tap ax=($X,$Y ${W}x${H}) click=($CX,$CY) nx=$NX ny=$NY"
else
  # Simulator window chrome: titlebar ~28–36pt, thin bottom bezel.
  # Previous 78/40 insets shifted mid-screen taps too low (tabs at 0.96 still hit).
  # Kept as fallback so Pro Max (--no-ax or AX-miss) stays on the proven path.
  INSET_TOP=32
  INSET_BOTTOM=18
  INSET_X=8
  CW=$(/usr/bin/python3 -c "print(int($W - 2*$INSET_X))")
  CH=$(/usr/bin/python3 -c "print(int($H - $INSET_TOP - $INSET_BOTTOM))")
  CX=$(/usr/bin/python3 -c "print(int(round($X + $INSET_X + $CW * $NX)))")
  CY=$(/usr/bin/python3 -c "print(int(round($Y + $INSET_TOP + $CH * $NY)))")
  echo "tap window=($X,$Y ${W}x${H}) content=${CW}x${CH} insets=32/18/8 click=($CX,$CY) nx=$NX ny=$NY"
fi

osascript -e 'tell application "Simulator" to activate'
sleep 0.15
CLICK=/opt/homebrew/bin/cliclick
if [[ ! -x "$CLICK" ]]; then
  CLICK=$(command -v cliclick || true)
fi
if [[ -z "${CLICK}" ]]; then
  echo "FAIL: cliclick not found" >&2
  exit 1
fi
"$CLICK" "c:${CX},${CY}"
echo "OK"
