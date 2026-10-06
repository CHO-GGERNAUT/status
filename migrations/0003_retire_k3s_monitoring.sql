-- Keep historical states/incidents, but retire cluster monitoring and its grants.
UPDATE components SET enabled = 0 WHERE group_key = 'k3s';

UPDATE reporters SET enabled = 0
WHERE EXISTS (
  SELECT 1 FROM reporter_components rc JOIN components c ON c.id = rc.component_id
  WHERE rc.reporter_id = reporters.id AND c.group_key = 'k3s'
)
AND NOT EXISTS (
  SELECT 1 FROM reporter_components rc JOIN components c ON c.id = rc.component_id
  WHERE rc.reporter_id = reporters.id AND c.group_key = 'devices'
);

DELETE FROM reporter_components
WHERE component_id IN (SELECT id FROM components WHERE group_key = 'k3s');
