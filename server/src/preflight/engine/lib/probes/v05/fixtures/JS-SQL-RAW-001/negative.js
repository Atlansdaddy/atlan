// XL-002 / JS-SQL-RAW-001 negative fixture.
// Parameterized query: the user value is bound, not interpolated.
export function getUser(db, userId) {
  return db.query('SELECT * FROM users WHERE id = $1', [userId]);
}
