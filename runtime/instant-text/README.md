# Instant Fast Text

US White 2 revision-0 PMC module under **Code Injection → Quality of Life**.
With native Text Speed set to Fast, it gives the message stream a bounded
128-character budget per update. Longer pages may need another update. Native
page advances, choices and control codes remain active. Slow/Normal and
deliberately slow script text preserve their behavior; the saved option is not
changed.

The installer checks native code and conflicting hooks. Build with
`python3 runtime/instant-text/build.py`; verify with
`python3 runtime/debug-helpers/verify.py /path/cleanwhite2.nds`.
Other ROM profiles and complete message-system/hardware timing need separate
verification.
