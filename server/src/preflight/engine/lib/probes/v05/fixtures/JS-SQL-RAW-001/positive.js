// XL-002 / JS-SQL-RAW-001 positive fixture.
// db.query called with a template literal that interpolates a user value.
export function getUser(db, userId) {
  return db.query(`SELECT * FROM users WHERE id = ${userId}`);
}
