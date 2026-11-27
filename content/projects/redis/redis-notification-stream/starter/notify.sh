# notify.sh — the college notification service.
#
#   setup_groups                                    creates the consumer groups email and push (safe to run again)
#   publish_notification <user> <text>              appends a notification; prints its stream ID
#   consume <group> <consumer> <handler>            handles up to BATCH new notifications for this consumer
#   recover <group> <consumer> <min idle ms> <handler>
#                                                   takes over notifications another consumer left unacknowledged
#
# A handler is called as: <handler> <stream id> <user> <text>. It returns 0 when the notification was sent.
#
# Today the service uses Pub/Sub: publish_notification sends to the channel "notifications", and the email and
# push workers each run SUBSCRIBE notifications. Whatever is published while a worker restarts is lost.
# TODO: move it to a stream with consumer groups — see the README.

publish_notification() {
  redis-cli PUBLISH notifications "$1: $2" > /dev/null
}

setup_groups() {
  echo "setup_groups: not implemented yet" >&2
  return 1
}

consume() {
  echo "consume: not implemented yet" >&2
  return 1
}

recover() {
  echo "recover: not implemented yet" >&2
  return 1
}
