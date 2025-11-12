const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// Αρχικό endpoint για έλεγχο
app.get('/', (req, res) => {
res.send('UniGreekAI Backend Running');
});

// ΝΕΟ endpoint για τμήματα
app.get('/api/departments', (req, res) => {
const departments = [
{ id: 1, name: 'Ηλεκτρολόγων Μηχανικών και Μηχανικών Υπολογιστών' },
{ id: 2, name: 'Μηχανικών Πληροφορικής' },
{ id: 3, name: 'Μηχανικών Τηλεπικοινωνιών' }
];
res.json(departments);
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
