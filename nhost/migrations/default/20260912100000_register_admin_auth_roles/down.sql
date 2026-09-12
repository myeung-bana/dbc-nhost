DELETE FROM auth.user_roles
WHERE role IN ('super_admin', 'organiser', 'member', 'casual');

DELETE FROM auth.roles
WHERE role IN ('super_admin', 'organiser', 'member', 'casual');
