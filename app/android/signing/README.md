# Production signing lineage: rotates Android Debug → mysewa-release-key.jks
# Used by `resignReleaseWithLineage` so debug-installed devices can update
# in-place without uninstalling.
#
# Recreate with:
#   apksigner rotate --out mysewa-debug-to-release.lineage \
#     --old-signer --ks %USERPROFILE%\.android\debug.keystore \
#       --ks-key-alias androiddebugkey --ks-pass pass:android --key-pass pass:android \
#     --new-signer --ks ..\app\mysewa-release-key.jks \
#       --ks-key-alias mysewa --ks-pass pass:keykey --key-pass pass:keykey
