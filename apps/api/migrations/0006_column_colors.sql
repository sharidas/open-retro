ALTER TABLE rooms ADD COLUMN column_colors TEXT NOT NULL DEFAULT '[]';
UPDATE rooms SET column_colors = (
  SELECT json_group_array(CASE key
    WHEN 0 THEN 'sage' WHEN 1 THEN 'peach' WHEN 2 THEN 'blue'
    WHEN 3 THEN 'lavender' ELSE 'sand' END)
  FROM json_each(rooms.columns)
);
