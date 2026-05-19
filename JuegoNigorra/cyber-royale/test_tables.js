import https from 'https';

const options = {
  hostname: 'witkxcyovfthqbpzqofd.supabase.co',
  path: '/rest/v1/cr_salas?select=*',
  headers: {
    'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndpdGt4Y3lvdmZ0aHFicHpxb2ZkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkxODk4NzMsImV4cCI6MjA5NDc2NTg3M30.tLx-HPhSUtpWWVeOS-7R7NZM8MCjGCkzN673Xna9dlo',
    'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndpdGt4Y3lvdmZ0aHFicHpxb2ZkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkxODk4NzMsImV4cCI6MjA5NDc2NTg3M30.tLx-HPhSUtpWWVeOS-7R7NZM8MCjGCkzN673Xna9dlo'
  }
};

https.get(options, (res) => {
  console.log('STATUS:', res.statusCode);
  let data = '';
  res.on('data', (chunk) => { data += chunk; });
  res.on('end', () => {
    console.log(data);
  });
}).on('error', (err) => {
  console.error(err);
});
