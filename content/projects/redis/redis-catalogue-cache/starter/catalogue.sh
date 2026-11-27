# catalogue.sh — product lookups for the campus shop's API.
# Use it after fake-db.sh:   source fake-db.sh; source catalogue.sh; get_product P100
#
#   get_product <id>          prints "id|name|price" (exactly as the database returns it) and returns 0,
#                             or prints nothing and returns 1 when there is no such product
#   update_price <id> <price> changes the price
#
# TODO: every call goes to the slow database. Add a Redis cache — see the README.

get_product() {
  db_get_product "$1"
}

update_price() {
  db_set_price "$1" "$2"
}
