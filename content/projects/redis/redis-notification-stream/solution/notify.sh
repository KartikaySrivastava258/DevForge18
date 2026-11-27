# notify.sh — the college notification service, on a Redis stream with consumer groups.
#
#   setup_groups                                    creates the consumer groups email and push (safe to run again)
#   publish_notification <user> <text>              appends a notification; prints its stream ID
#   consume <group> <consumer> <handler>            handles up to BATCH new notifications for this consumer
#   recover <group> <consumer> <min idle ms> <handler>
#                                                   takes over notifications another consumer left unacknowledged
#
# A handler is called as: <handler> <stream id> <user> <text>. It returns 0 when the notification was sent.
# Only then is the entry acknowledged; otherwise it stays pending in the group, to be recovered later.
#
# Settings: BATCH (entries per call, default 10), STREAM_MAXLEN (about how many entries to keep, default 10000),
# DEAD_AFTER (deliveries before a failing entry is moved to notifications:dead, default 3).

STREAM=notifications
DEAD_STREAM=notifications:dead

setup_groups() {
  local group out
  for group in email push; do
    # $ = deliver what is published from now on; MKSTREAM creates the stream if it does not exist yet.
    out="$(redis-cli XGROUP CREATE "$STREAM" "$group" '$' MKSTREAM 2>&1)"
    # A second run answers BUSYGROUP: the group exists already, which is what we want.
    case "$out" in OK | *BUSYGROUP*) ;; *) echo "setup_groups: $out" >&2; return 1 ;; esac
  done
}

publish_notification() {
  # MAXLEN ~ trims old entries in whole blocks, which is cheap; the stream keeps at least STREAM_MAXLEN entries.
  redis-cli --raw XADD "$STREAM" MAXLEN '~' "${STREAM_MAXLEN:-10000}" '*' user "$1" text "$2"
}

# _entries: reads redis-cli --raw output and prints one "id<TAB>user<TAB>text" line per entry. In --raw output
# every entry is five lines — id, "user", user, "text", text — among other lines: the stream name, or
# XAUTOCLAIM's cursor (which looks like an ID, such as 0-0). So an entry is recognised by its whole shape.
# (Assumes texts have no line breaks or tabs; the publisher could reject those.)
_entries() {
  local -a l
  local i=0
  mapfile -t l
  while [ "$i" -lt "${#l[@]}" ]; do
    if [[ "${l[i]}" =~ ^[0-9]+-[0-9]+$ ]] && [ "${l[i + 1]:-}" = user ] && [ "${l[i + 3]:-}" = text ]; then
      printf '%s\t%s\t%s\n' "${l[i]}" "${l[i + 2]}" "${l[i + 4]}"
      i=$((i + 5))
    else
      i=$((i + 1))
    fi
  done
}

# _handle <group> <handler> <id> <user> <text>: run the handler; acknowledge on success. After DEAD_AFTER failed
# deliveries, park the entry in the dead-letter stream and acknowledge it, so it stops being retried for ever.
_handle() {
  local group="$1" handler="$2" id="$3" user="$4" text="$5" deliveries
  if "$handler" "$id" "$user" "$text"; then
    redis-cli XACK "$STREAM" "$group" "$id" > /dev/null
    return
  fi
  # XPENDING … <id> <id> 1 gives: id, consumer, idle time, number of deliveries.
  deliveries="$(redis-cli --raw XPENDING "$STREAM" "$group" "$id" "$id" 1 | sed -n 4p)"
  if [ "${deliveries:-0}" -ge "${DEAD_AFTER:-3}" ]; then
    redis-cli XADD "$DEAD_STREAM" '*' original_id "$id" group "$group" user "$user" text "$text" > /dev/null
    redis-cli XACK "$STREAM" "$group" "$id" > /dev/null
  fi
}

consume() {
  local group="$1" consumer="$2" handler="$3" id user text
  # ">" = entries never delivered to anyone in this group. Without BLOCK, the call returns at once.
  while IFS=$'\t' read -r id user text; do
    _handle "$group" "$handler" "$id" "$user" "$text" < /dev/null # keep the handler off the loop's input
  done < <(redis-cli --raw XREADGROUP GROUP "$group" "$consumer" COUNT "${BATCH:-10}" STREAMS "$STREAM" '>' | _entries)
}

recover() {
  local group="$1" consumer="$2" min_idle="$3" handler="$4" id user text
  # Claim entries that have been pending for at least min_idle ms, whoever they were delivered to; each claim
  # counts as one more delivery.
  while IFS=$'\t' read -r id user text; do
    _handle "$group" "$handler" "$id" "$user" "$text" < /dev/null # keep the handler off the loop's input
  done < <(redis-cli --raw XAUTOCLAIM "$STREAM" "$group" "$consumer" "$min_idle" 0-0 COUNT "${BATCH:-10}" | _entries)
}
