import { loadLocalEnv } from './load-env.mjs';
import { query } from '../server/db.js';

loadLocalEnv();

const localProjects = [
  {
    name: 'math-paper',
    description: 'Lean 4 formalization and verification project with proof scripts, extracted Lean sources and verification artifacts.',
    localPath: 'E:/sandbox/默认项目/math-paper',
    relation: 'ownership',
    status: 'active',
    priority: 'high',
  },
];

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'project';
}

await query(
  `update projects
   set visible = true, relation = 'contribute', relation_source = 'manual', updated_at = now()
   where full_name in ('natricknye/Dela', 'natricknye/opencode')`
);

for (const project of localProjects) {
  const fullName = `local/${slugify(project.name)}`;
  const rows = await query(
    `insert into projects (
       github_id, full_name, owner_login, name, description, html_url, homepage,
       language, stars, forks, open_issues, is_private, is_fork, is_archived,
       is_deleted, relation, relation_source, status, priority, visible, local_path
     ) values (
       null,$1,null,$2,$3,'','','',0,0,0,false,false,false,false,$4,'manual',$5,$6,true,$7
     )
     on conflict (full_name) do update set
       name = excluded.name,
       description = excluded.description,
       local_path = excluded.local_path,
       relation = excluded.relation,
       status = excluded.status,
       priority = excluded.priority,
       visible = true,
       updated_at = now()
     returning id, name, full_name, relation, status, priority, visible, local_path`,
    [fullName, project.name, project.description, project.relation, project.status, project.priority, project.localPath]
  );
  console.log(JSON.stringify(rows[0]));
}

const summary = await query(
  `select full_name, relation, is_private, is_fork, visible
   from projects
   order by relation, full_name`
);
console.table(summary);
process.exit(0);
