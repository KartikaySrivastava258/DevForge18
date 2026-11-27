# fake-db.sh — a stand-in for the shop's product database. Do not change it: the check uses its own copy.
# Every query takes 0.2 seconds and is written to a query log, so you can count how often the cache saves a trip.
#   db_get_product <id>        prints "id|name|price" and returns 0, or prints nothing and returns 1
#   db_set_price <id> <price>  changes the product's price in the database
DB_FILE="${DB_FILE:-products.db}"
DB_LOG="${DB_LOG:-db-queries.log}"

db_get_product() {
  echo "get $1" >> "$DB_LOG"
  sleep 0.2
  grep -m1 "^$1|" "$DB_FILE"
}

db_set_price() {
  echo "set $1 $2" >> "$DB_LOG"
  awk -F'|' -v OFS='|' -v id="$1" -v price="$2" '$1 == id { $3 = price } { print }' "$DB_FILE" > "$DB_FILE.tmp" &&
    mv "$DB_FILE.tmp" "$DB_FILE"
}
