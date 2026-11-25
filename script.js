// ═══════════════════════════════════════════════════════════════
//  FIREBASE
// ═══════════════════════════════════════════════════════════════

firebase.initializeApp({
  apiKey: "AIzaSyAEkxrFQYP6c0IJc0xLlLx3HC7rjYFVPTY",
  authDomain: "base-de-datos-app-web-82d97.firebaseapp.com",
  projectId: "base-de-datos-app-web-82d97",
  storageBucket: "base-de-datos-app-web-82d97.firebasestorage.app",
  messagingSenderId: "900408177323",
  appId: "1:900408177323:web:4ad896949abdafea26fdee"
});
const authFB = firebase.auth();
const fdb = firebase.firestore();

// ═══════════════════════════════════════════════════════════════
//  ESTADO GLOBAL
// ═══════════════════════════════════════════════════════════════

const TURNO_LABEL = { M: "Mañana", T: "Tarde", N: "Noche" };
const TURNO_LIST = ["M", "T", "N"];

const state = {
  currentCourseId: null,
  date: new Date().toISOString().slice(0, 10),
  turno: (() => { const h = new Date().getHours(); if (h < 13) return "M"; if (h < 19) return "T"; return "N"; })(),
  selectedStudent: null,
  editingStudent: false,
};
let cachedStudents = [];
let currentStatusMap = new Map();

const $$ = (s) => document.querySelectorAll(s);

// ═══════════════════════════════════════════════════════════════
//  PÁGINAS
// ═══════════════════════════════════════════════════════════════

function showPage(name) {
  $$(".page").forEach(p => p.classList.remove("active"));
  const el = document.getElementById("page" + name.charAt(0).toUpperCase() + name.slice(1));
  if (el) el.classList.add("active");
  const nav = document.getElementById("bottomNav");
  if (nav) nav.style.display = name === "auth" ? "none" : "flex";
}

function navigate(page, data) {
  if (page === "curso" && data) state.currentCourseId = data;
  showPage(page);
  if (page === "dashboard") renderDashboard();
  if (page === "curso") renderCurso();
  if (page === "manual") renderManual();
  if (page === "informe") renderInforme();
  if (page === "ajustes") renderAjustes();
  updateBottomNav(page);
}

function updateBottomNav(page) {
  const nav = document.getElementById("bottomNav");
  if (!nav) return;
  const map = { dashboard: "navDashboard", manual: "navManual", informe: "navInforme", ajustes: "navAjustes" };
  nav.querySelectorAll("a").forEach(a => a.classList.remove("active"));
  const id = map[page === "curso" ? "dashboard" : page];
  if (id) document.getElementById(id)?.classList.add("active");
}

// ═══════════════════════════════════════════════════════════════
//  AUTH UI
// ═══════════════════════════════════════════════════════════════

let isRegister = false;

function toggleAuthMode() {
  isRegister = !isRegister;
  document.getElementById("nameGroup").style.display = isRegister ? "block" : "none";
  document.getElementById("authSubmit").textContent = isRegister ? "Registrarse" : "Ingresar";
  document.getElementById("authSwitchText").textContent = isRegister ? "¿Ya tenés cuenta?" : "¿No tenés cuenta?";
  document.getElementById("authSwitchLink").textContent = isRegister ? "Ingresar" : "Registrarse";
  document.getElementById("authError").style.display = "none";
}

function showAuthError(msg) {
  const el = document.getElementById("authError");
  el.textContent = msg;
  el.style.display = "block";
}

document.getElementById("authForm").addEventListener("submit", async function(e) {
  e.preventDefault();
  const email = document.getElementById("authEmail").value.trim();
  const password = document.getElementById("authPassword").value;
  const name = document.getElementById("authName").value.trim();
  document.getElementById("authError").style.display = "none";

  try {
    if (isRegister) {
      if (!name) { showAuthError("Completá tu nombre"); return; }
      const cred = await authFB.createUserWithEmailAndPassword(email, password);
      await cred.user.updateProfile({ displayName: name });
      await fdb.collection("users").doc(cred.user.uid).set({
        full_name: name,
        email,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      toast("Registrado correctamente");
    } else {
      await authFB.signInWithEmailAndPassword(email, password);
    }
  } catch (err) {
    const msgs = {
      "auth/user-not-found": "No hay una cuenta con ese email",
      "auth/wrong-password": "Contraseña incorrecta",
      "auth/invalid-credential": "Email o contraseña incorrectos",
      "auth/email-already-in-use": "Este email ya está registrado",
      "auth/weak-password": "La contraseña debe tener al menos 6 caracteres",
      "auth/too-many-requests": "Demasiados intentos. Esperá un momento.",
    };
    showAuthError(msgs[err.code] || err.message);
  }
});

function logout() {
  authFB.signOut();
}

function updateUserNames(name) {
  for (let i = 1; i <= 5; i++) {
    const el = document.getElementById("userNameDisplay" + (i === 1 ? "" : i));
    if (el) el.textContent = name;
  }
}

// ═══════════════════════════════════════════════════════════════
//  SEED
// ═══════════════════════════════════════════════════════════════

async function wipeAllCollections() {
  const names = ["students", "attendance", "savedLists", "specialDays"];
  for (const name of names) {
    const snap = await fdb.collection(name).get();
    if (snap.empty) continue;
    let batch = fdb.batch();
    let i = 0;
    for (const doc of snap.docs) {
      batch.delete(doc.ref);
      i++;
      if (i % 400 === 0) { await batch.commit(); batch = fdb.batch(); }
    }
    if (i % 400 !== 0) await batch.commit();
  }
}

async function cleanupTRecords() {
  const snap = await fdb.collection("attendance").where("status", "==", "T").get();
  if (snap.empty) return;
  let batch = fdb.batch();
  let i = 0;
  for (const doc of snap.docs) {
    batch.delete(doc.ref);
    i++;
    if (i % 400 === 0) { await batch.commit(); batch = fdb.batch(); }
  }
  if (i % 400 !== 0) await batch.commit();
}

async function seedFirestoreIfEmpty() {
  const ref = fdb.collection("students").doc("stu_1");
  const existing = await ref.get();
  if (existing.exists) {
    const data = existing.data();
    const alreadyV2 = data && data.full_name === "Juan Pérez";
    if (alreadyV2) {
      await cleanupTRecords();
      return;
    }
    // old data detected — wipe everything so we can re-seed with repeated names
    await wipeAllCollections();
  }

  const STUDENTS = [
    { full_name: "Juan Pérez", gender: "M", dni: "45.123.456" },
    { full_name: "María Pérez", gender: "F", dni: "45.123.457" },
    { full_name: "Juan Rodríguez", gender: "M", dni: "45.123.458", guardian_name: "Rodríguez, Ana", guardian_authorized: true },
    { full_name: "Sofía Rodríguez", gender: "F", dni: "45.123.459" },
    { full_name: "Lautaro García", gender: "M", dni: "45.123.460", health_notes: "Asma - usa inhalador" },
    { full_name: "Martina García", gender: "F", dni: "45.123.461" },
    { full_name: "Juan Martínez", gender: "M", dni: "45.123.462", address: "San Martín 890" },
    { full_name: "Lucía Martínez", gender: "F", dni: "45.123.463" },
    { full_name: "Pedro López", gender: "M", dni: "45.123.464" },
    { full_name: "Camila López", gender: "F", dni: "45.123.465", guardian_name: "López, Carlos", guardian_authorized: true },
    { full_name: "Santiago Fernández", gender: "M", dni: "45.123.466", health_notes: "Alérgico al maní" },
    { full_name: "Valentina Fernández", gender: "F", dni: "45.123.467", address: "Belgrano 1234" },
    { full_name: "Mateo Díaz", gender: "M", dni: "45.123.468" },
    { full_name: "Emilia Díaz", gender: "F", dni: "45.123.469" },
    { full_name: "Juan López", gender: "M", dni: "45.123.470" },
    { full_name: "Sofía García", gender: "F", dni: "45.123.471" },
  ];

  const batch = fdb.batch();
  STUDENTS.forEach((s, i) => {
    batch.set(fdb.collection("students").doc("stu_" + (i + 1)), { ...s, course: "6°1°" });
  });
  await batch.commit();

  await seedSampleAttendance(STUDENTS);

  await cleanupTRecords();

  cachedStudents = [];
}

async function seedSampleAttendance(students) {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const lastDay = new Date(year, now.getMonth() + 1, 0).getDate();

  const turnos = ["M", "T"];
  const statuses = ["P", "P", "P", "P", "A", "P", "P", "P", "A", "P"];

  let batch = fdb.batch();
  let count = 0;

  for (let d = 1; d <= lastDay; d++) {
    const date = new Date(year, now.getMonth(), d);
    const dow = date.getDay();
    if (dow === 0 || dow === 6) continue;

    const dateStr = year + "-" + month + "-" + String(d).padStart(2, "0");

    for (const s of students) {
      const sid = "stu_" + (students.indexOf(s) + 1);
      for (const turno of turnos) {
        if (Math.random() > 0.85) continue; // some days missing some shifts
        const st = statuses[Math.floor(Math.random() * statuses.length)];
        const docId = sid + "_" + dateStr + "_" + turno;
        batch.set(fdb.collection("attendance").doc(docId), {
          student_id: sid, date: dateStr, turno, status: st,
          taken_by: "seed@asistencia.app",
          takenAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        count++;
        if (count % 400 === 0) { await batch.commit(); batch = fdb.batch(); count = 0; }
      }
    }
  }

  if (count > 0) await batch.commit();
}

// ═══════════════════════════════════════════════════════════════
//  DASHBOARD
// ═══════════════════════════════════════════════════════════════

async function renderDashboard() {
  const grid = document.getElementById("courseGrid");

  const [coursesSnap, studentsSnap] = await Promise.all([
    fdb.collection("courses").get(),
    fdb.collection("students").get()
  ]);

  const courses = [];
  coursesSnap.forEach(doc => courses.push({ id: doc.id, ...doc.data() }));

  const courseStats = {};
  studentsSnap.forEach(doc => {
    const d = doc.data();
    const c = d.course;
    if (!c) return;
    if (!courseStats[c]) courseStats[c] = { total: 0, totalM: 0, totalF: 0 };
    courseStats[c].total++;
    if (d.gender === "M") courseStats[c].totalM++;
    if (d.gender === "F") courseStats[c].totalF++;
  });

  for (const c of Object.keys(courseStats)) {
    if (!courses.some(co => co.name === c)) {
      courses.push({ id: c, name: c });
    }
  }

  if (courses.length === 0) {
    grid.innerHTML = `
      <div style="text-align:center;padding:32px 16px;color:var(--muted-foreground)">
        <p style="font-size:14px;margin-bottom:12px">No hay cursos todavía</p>
        <button class="btn" style="background:var(--eest-orange);color:var(--eest-blue);font-weight:700;margin:0 auto" onclick="showAddCourseModal()">+ Agregar curso</button>
      </div>`;
    return;
  }

  grid.innerHTML = courses.map(c => {
    const stats = courseStats[c.name] || { total: 0, totalM: 0, totalF: 0 };
    return `
      <div class="course-card" onclick="navigate('curso','${esc(c.name)}')">
        <div class="cc-banner">
          <h3>${esc(c.name)}</h3>
          <div class="cc-sub">E.E.S.T. N°5 · Preceptoría</div>
          <img src="LOGO.webp" alt="" class="cc-logo">
        </div>
        <h3 class="cc-mobile-title">${esc(c.name)}</h3>
        <div class="cc-body">
          <div class="course-meta">
            <span>👤 ${stats.total} alumnos</span>
            <span>♂ ${stats.totalM}</span>
            <span>♀ ${stats.totalF}</span>
          </div>
          <div class="course-badge">Ver lista</div>
        </div>
      </div>`;
  }).join('') + `
    <div class="course-card add-course-card" onclick="showAddCourseModal()">
      <div class="add-course-inner">
        <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>
        <span>Agregar curso</span>
      </div>
    </div>`;
}

// ═══════════════════════════════════════════════════════════════
//  AGREGAR CURSO
// ═══════════════════════════════════════════════════════════════

function showAddCourseModal() {
  const overlay = document.getElementById("modalOverlay");
  const modal = document.getElementById("modal");
  modal.innerHTML = `
    <div class="modal-header">
      <h2 class="modal-title">Agregar curso</h2>
      <button class="modal-close" onclick="closeModal()">×</button>
    </div>
    <form id="addCourseForm" onsubmit="event.preventDefault();saveCourse()">
      <div class="form-group">
        <label>Nombre del curso</label>
        <input type="text" name="courseName" placeholder="Ej: 5° 2°" required autocomplete="off">
      </div>
      <div style="display:flex;gap:8px;margin-top:16px">
        <button type="button" class="btn" style="background:var(--muted);color:var(--text);flex:1" onclick="closeModal()">Cancelar</button>
        <button type="submit" class="btn" style="background:var(--eest-orange);color:var(--eest-blue);font-weight:700;flex:1">Crear curso</button>
      </div>
    </form>
  `;
  overlay.classList.add("open");
  setTimeout(() => modal.querySelector("input")?.focus(), 100);
}

async function saveCourse() {
  const form = document.getElementById("addCourseForm");
  const name = form.courseName.value.trim();
  if (!name) { toast("El nombre es obligatorio"); return; }
  await fdb.collection("courses").doc(name).set({ name });
  closeModal();
  toast("Curso creado");
  renderDashboard();
}

// ═══════════════════════════════════════════════════════════════
//  GESTIÓN DEL CURSO
// ═══════════════════════════════════════════════════════════════

async function deleteCourse() {
  const courseName = state.currentCourseId;
  if (!confirm(`¿Eliminar el curso "${courseName}"?\n\nSe borrarán todos los alumnos y registros de asistencia de este curso.`)) return;
  if (!confirm(`¿Estás seguro? Esta acción no se puede deshacer.`)) return;

  const batch = fdb.batch();
  const studentsSnap = await fdb.collection("students").where("course", "==", courseName).get();
  studentsSnap.forEach(doc => batch.delete(doc.ref));

  const attSnap = await fdb.collection("attendance").get();
  const studentIds = new Set();
  studentsSnap.forEach(doc => studentIds.add(doc.id));
  attSnap.forEach(doc => {
    const d = doc.data();
    if (studentIds.has(d.student_id)) batch.delete(doc.ref);
  });

  const savedSnap = await fdb.collection("savedLists").get();
  savedSnap.forEach(doc => {
    if (doc.id.startsWith(courseName + "|")) batch.delete(doc.ref);
  });

  batch.delete(fdb.collection("courses").doc(courseName));
  await batch.commit();
  toast(`Curso "${courseName}" eliminado`);
  navigate("dashboard");
}

async function showDeleteStudentsModal() {
  const overlay = document.getElementById("modalOverlay");
  const modal = document.getElementById("modal");
  const snap = await fdb.collection("students").where("course", "==", state.currentCourseId).get();
  const students = [];
  snap.forEach(doc => students.push({ id: doc.id, ...doc.data() }));

  if (students.length === 0) {
    toast("No hay alumnos en este curso");
    return;
  }

  modal.innerHTML = `
    <div class="modal-header">
      <h2 class="modal-title">Eliminar alumno</h2>
      <button class="modal-close" onclick="closeModal()">×</button>
    </div>
    <p style="font-size:13px;color:var(--muted-foreground);margin-bottom:12px">Seleccioná los alumnos que querés eliminar:</p>
    <div style="max-height:300px;overflow-y:auto">
      ${students.map(s => `
        <label class="import-student-row">
          <input type="checkbox" value="${s.id}" class="delete-student-cb">
          <span>${esc(s.full_name)}</span>
          <span style="font-size:11px;color:var(--muted-foreground)">${s.gender === 'M' ? '♂' : '♀'}</span>
        </label>
      `).join('')}
    </div>
    <div style="display:flex;gap:8px;margin-top:16px">
      <button type="button" class="btn" style="background:var(--muted);color:var(--text);flex:1" onclick="closeModal()">Cancelar</button>
      <button type="button" class="btn" style="background:var(--destructive);color:#fff;font-weight:700;flex:1" onclick="deleteSelectedStudents()">Eliminar seleccionados</button>
    </div>
  `;
  overlay.classList.add("open");
}

async function deleteSelectedStudents() {
  const cbs = document.querySelectorAll(".delete-student-cb:checked");
  if (cbs.length === 0) { toast("Seleccioná al menos un alumno"); return; }

  if (!confirm(`¿Eliminar ${cbs.length} alumno(s) definitivamente?`)) return;

  const ids = [];
  cbs.forEach(cb => ids.push(cb.value));
  const batch = fdb.batch();

  for (const id of ids) {
    batch.delete(fdb.collection("students").doc(id));
    const attSnap = await fdb.collection("attendance").where("student_id", "==", id).get();
    attSnap.forEach(doc => batch.delete(doc.ref));
  }

  await batch.commit();
  cachedStudents = [];
  closeModal();
  toast(`${ids.length} alumno(s) eliminado(s)`);
  renderCursoContent();
}

function showCourseManagementModal() {
  const overlay = document.getElementById("modalOverlay");
  const modal = document.getElementById("modal");
  modal.innerHTML = `
    <div class="modal-header">
      <h2 class="modal-title">Gestión del curso</h2>
      <button class="modal-close" onclick="closeModal()">×</button>
    </div>
    <div class="gestion-grid">
      <div class="gestion-card" onclick="closeModal();showEditCourseModal()">
        <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>
        <span class="gestion-card-title">Editar curso</span>
        <span class="gestion-card-desc">Cambiar nombre del curso</span>
      </div>
      <div class="gestion-card" onclick="closeModal();showImportStudentsModal()">
        <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="m19 12-7 7-7-7"/></svg>
        <span class="gestion-card-title">Importar alumnos</span>
        <span class="gestion-card-desc">Copiar alumnos de otro curso</span>
      </div>
      <div class="gestion-card" onclick="closeModal();addNewStudent()">
        <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><line x1="17" y1="8" x2="19" y2="8"/><line x1="18" y1="7" x2="18" y2="9"/></svg>
        <span class="gestion-card-title">Agregar alumno</span>
        <span class="gestion-card-desc">Añadir un alumno nuevo al curso</span>
      </div>
      <div class="gestion-card gestion-card-danger" onclick="closeModal();showDeleteStudentsModal()">
        <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
        <span class="gestion-card-title">Eliminar alumno</span>
        <span class="gestion-card-desc">Borrar un alumno del curso</span>
      </div>
      <div class="gestion-card gestion-card-danger" onclick="closeModal();deleteCourse()">
        <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
        <span class="gestion-card-title">Eliminar curso</span>
        <span class="gestion-card-desc">Borrar este curso y todos sus alumnos</span>
      </div>
    </div>
  `;
  overlay.classList.add("open");
}

function showEditCourseModal() {
  const currentName = state.currentCourseId;
  const overlay = document.getElementById("modalOverlay");
  const modal = document.getElementById("modal");
  modal.innerHTML = `
    <div class="modal-header">
      <h2 class="modal-title">Editar curso</h2>
      <button class="modal-close" onclick="closeModal()">×</button>
    </div>
    <form id="editCourseForm" onsubmit="event.preventDefault();saveCourseName()">
      <div class="form-group">
        <label>Nombre actual</label>
        <input type="text" value="${esc(currentName)}" disabled style="opacity:.6">
      </div>
      <div class="form-group">
        <label>Nuevo nombre</label>
        <input type="text" name="newCourseName" placeholder="Ej: 5° 2°" required autocomplete="off">
      </div>
      <div style="display:flex;gap:8px;margin-top:16px">
        <button type="button" class="btn" style="background:var(--muted);color:var(--text);flex:1" onclick="closeModal()">Cancelar</button>
        <button type="submit" class="btn" style="background:var(--eest-orange);color:var(--eest-blue);font-weight:700;flex:1">Guardar</button>
      </div>
    </form>
  `;
  overlay.classList.add("open");
  setTimeout(() => modal.querySelector("input[name='newCourseName']")?.focus(), 100);
}

async function saveCourseName() {
  const form = document.getElementById("editCourseForm");
  const newName = form.newCourseName.value.trim();
  if (!newName) { toast("El nombre es obligatorio"); return; }
  const oldName = state.currentCourseId;
  if (newName === oldName) { closeModal(); toast("Sin cambios"); return; }

  const batch = fdb.batch();
  batch.set(fdb.collection("courses").doc(newName), { name: newName });
  const oldCourseRef = fdb.collection("courses").doc(oldName);
  const oldSnap = await oldCourseRef.get();
  if (oldSnap.exists) batch.delete(oldCourseRef);

  const studentsSnap = await fdb.collection("students").where("course", "==", oldName).get();
  studentsSnap.forEach(doc => batch.update(doc.ref, { course: newName }));

  await batch.commit();
  state.currentCourseId = newName;
  closeModal();
  toast("Curso renombrado");
  renderCursoContent();
}

function showImportStudentsModal() {
  const overlay = document.getElementById("modalOverlay");
  const modal = document.getElementById("modal");
  modal.innerHTML = `
    <div class="modal-header">
      <h2 class="modal-title">Importar alumnos</h2>
      <button class="modal-close" onclick="closeModal()">×</button>
    </div>
    <div class="form-group">
      <label>Seleccionar curso origen</label>
      <select id="importSourceCourse" onchange="loadSourceCourseStudents()" style="width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:var(--radius-sm);font-size:14px;font-family:inherit">
        <option value="">— Seleccioná un curso —</option>
      </select>
    </div>
    <div id="importStudentList" style="max-height:300px;overflow-y:auto"></div>
    <div style="display:flex;gap:8px;margin-top:16px">
      <button type="button" class="btn" style="background:var(--muted);color:var(--text);flex:1" onclick="closeModal()">Cancelar</button>
      <button type="button" class="btn" style="background:var(--eest-orange);color:var(--eest-blue);font-weight:700;flex:1" onclick="importSelectedStudents()" id="btnImportStudents" disabled>Importar seleccionados</button>
    </div>
  `;
  overlay.classList.add("open");
  loadImportCourses();
}

async function loadImportCourses() {
  const select = document.getElementById("importSourceCourse");
  if (!select) return;
  const snap = await fdb.collection("courses").get();
  let html = '<option value="">— Seleccioná un curso —</option>';
  snap.forEach(doc => {
    const name = doc.data().name;
    if (name !== state.currentCourseId) {
      html += `<option value="${esc(name)}">${esc(name)}</option>`;
    }
  });
  select.innerHTML = html;
}

async function loadSourceCourseStudents() {
  const select = document.getElementById("importSourceCourse");
  const container = document.getElementById("importStudentList");
  const btn = document.getElementById("btnImportStudents");
  const course = select.value;
  if (!course || !container) {
    if (container) container.innerHTML = "";
    if (btn) btn.disabled = true;
    return;
  }

  const snap = await fdb.collection("students").where("course", "==", course).get();
  const students = [];
  snap.forEach(doc => students.push({ id: doc.id, ...doc.data() }));

  const currentIds = new Set(cachedStudents.map(s => s.id));
  const available = students.filter(s => !currentIds.has(s.id) && !s.baja);
  const existing = students.filter(s => currentIds.has(s.id));

  if (available.length === 0 && existing.length === 0) {
    container.innerHTML = '<div style="text-align:center;padding:16px;color:var(--muted-foreground);font-size:13px">No hay alumnos en ese curso</div>';
    if (btn) btn.disabled = true;
    return;
  }

  let html = '<div style="font-size:12px;color:var(--muted-foreground);margin-bottom:8px">Seleccioná alumnos para importar:</div>';
  if (available.length > 0) {
    html += available.map(s => `
      <label class="import-student-row">
        <input type="checkbox" value="${s.id}" class="import-cb">
        <span>${esc(s.full_name)}</span>
        <span style="font-size:11px;color:var(--muted-foreground)">${s.gender === 'M' ? '♂' : '♀'}</span>
      </label>
    `).join('');
  }
  if (existing.length > 0) {
    html += '<div style="font-size:11px;color:var(--muted-foreground);margin-top:8px;padding:8px;background:var(--muted);border-radius:6px">⚠️ Ya están en este curso: ' + existing.map(s => esc(s.full_name)).join(', ') + '</div>';
  }
  container.innerHTML = html;
  if (btn) btn.disabled = false;
}

async function importSelectedStudents() {
  const cbs = document.querySelectorAll(".import-cb:checked");
  if (cbs.length === 0) { toast("Seleccioná al menos un alumno"); return; }

  const ids = [];
  cbs.forEach(cb => ids.push(cb.value));
  const targetCourse = state.currentCourseId;
  const batch = fdb.batch();
  let imported = 0;

  for (const id of ids) {
    const snap = await fdb.collection("students").doc(id).get();
    if (!snap.exists) continue;
    const data = snap.data();
    const copy = { ...data, course: targetCourse };
    delete copy.id;
    const newRef = fdb.collection("students").doc();
    batch.set(newRef, copy);
    imported++;
  }

  await batch.commit();
  cachedStudents = [];
  closeModal();
  toast(`${imported} alumno(s) importado(s)`);
  renderCursoContent();
}

// ═══════════════════════════════════════════════════════════════
//  CURSO
// ═══════════════════════════════════════════════════════════════

function renderCurso() {
  const container = document.getElementById("cursoContent");
  container.innerHTML = '<div class="loading">Cargando...</div>';
  renderCursoContent();
}

async function renderCursoContent() {
  const { currentCourseId, date, turno } = state;
  const container = document.getElementById("cursoContent");
  if (!container) return;

  if (!cachedStudents.length || cachedStudents[0]?.course !== currentCourseId) {
    const snap = await fdb.collection("students").where("course", "==", currentCourseId).get();
    cachedStudents = [];
    snap.forEach(doc => cachedStudents.push({ id: doc.id, ...doc.data() }));
  }
  const students = cachedStudents;

  const [attSnap, savedDoc, specialSnap] = await Promise.all([
    fdb.collection("attendance").where("date", "==", date).where("turno", "==", turno).get(),
    fdb.collection("savedLists").doc(currentCourseId + "|" + date + "|" + turno).get(),
    fdb.collection("specialDays").doc(date).get()
  ]);

  currentStatusMap = new Map();
  attSnap.forEach(doc => {
    const d = doc.data();
    if (students.some(s => s.id === d.student_id)) {
      currentStatusMap.set(d.student_id, d.status);
    }
  });

  const totals = { P: 0, A: 0 };
  for (const st of currentStatusMap.values()) {
    if (st === "P") totals.P++;
    else if (st === "A") totals.A++;
  }
  const totalM = students.filter(s => s.gender === "M").length;
  const totalF = students.filter(s => s.gender === "F").length;
  const total = students.length;
  const registeredCount = currentStatusMap.size;

  const saved = savedDoc.exists;
  const specialDay = specialSnap.exists ? specialSnap.data() : null;
  const isFeriado = specialDay && (specialDay.type === "feriado" || specialDay.type === "jornada");
  const monthKey = date.slice(0, 7);
  const feriadoClass = specialDay ? ' active-' + specialDay.type : '';

  container.innerHTML = `
    <div class="hero">
      <div class="hero-top">
        <div>
          <div class="hero-label">Curso</div>
          <h1 class="hero-title">${currentCourseId}</h1>
          <p class="hero-sub">${fmtDate(date)} · Turno ${TURNO_LABEL[turno]}</p>
        </div>
        <div class="totals-grid">
          <div class="total-chip"><div class="total-chip-label">P</div><div class="total-chip-value">${totals.P}</div></div>
          <div class="total-chip"><div class="total-chip-label">A</div><div class="total-chip-value">${totals.A}</div></div>
          <div class="total-chip"><div class="total-chip-label">M</div><div class="total-chip-value">${totalM}</div></div>
          <div class="total-chip"><div class="total-chip-label">F</div><div class="total-chip-value">${totalF}</div></div>
        </div>
      </div>
      <div class="controls">
        <label style="display:flex;align-items:center;gap:6px;font-size:13px">
          <span style="opacity:.9">Fecha:</span>
          <input type="date" class="date-input" value="${date}" onchange="updateDate(this.value)">
        </label>
        <div class="turno-group">
          ${TURNO_LIST.map(t => `
            <button class="turno-btn${turno === t ? ' active' : ''}" onclick="updateTurno('${t}')">${TURNO_LABEL[t]}</button>
          `).join('')}
        </div>
        <div class="register-count">Registrados: <strong>${registeredCount}</strong> de <strong>${total}</strong></div>
      </div>
      <div class="controls-row2">
        <button class="btn-save${saved ? ' saved' : ''}" id="btnSave" onclick="saveList()" ${currentStatusMap.size === 0 ? 'disabled' : ''}>
          ${saved ? '✓ Guardada' : '💾 Guardar lista'}
        </button>
        <button class="btn-feriado${feriadoClass}" onclick="toggleFeriado()">${specialDay ? specialDay.type.charAt(0).toUpperCase() + specialDay.type.slice(1) : '🚩 Feriado'}</button>
        <button class="btn-gestion" onclick="showCourseManagementModal()">⚙️ Gestión</button>
      </div>
      ${isFeriado ? '<div class="feriado-banner type-' + specialDay.type + '">🚩 Día marcado como <strong>' + specialDay.type.toUpperCase() + '</strong> — No se toman asistencias</div>' : ''}
    </div>

    <div class="curso-grid">
    <div class="curso-col-list">
    ${students.length === 0 ? '<div class="loading">No hay alumnos en este curso</div>' : `
    <div class="student-list">
      ${students.map((s, i) => {
        const st = currentStatusMap.get(s.id);
        return `
        <div class="student-card${s.baja ? ' student-baja' : ''}" data-sid="${s.id}">
          <button class="student-info" onclick="openModal('${s.id}')">
            <span class="student-num">${i + 1}</span>
            <span class="student-gender ${s.gender}">${s.gender}</span>
            <span class="student-name" title="${esc(s.full_name)}">${esc(s.full_name)}${s.baja ? ' <span class="baja-badge">BAJA</span>' : ''}</span>
            ${s.health_notes ? `<span class="health-icon">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4"/><path d="M10.363 3.591 2.257 17.125a1 1 0 0 0 .873 1.507h17.74a1 1 0 0 0 .873-1.507L13.637 3.591a1 1 0 0 0-1.728 0Z"/><circle cx="12" cy="17" r=".5" fill="currentColor" stroke="none"/></svg>
            </span>` : ''}
          </button>
          <div class="status-group">
            ${['P','A'].map(opt => `
              <button class="status-btn ${st === opt ? 'active-' + opt : ''}" onclick="markStatus('${s.id}','${opt}')" ${isFeriado || s.baja ? 'disabled' : ''}>${opt}</button>
            `).join('')}
          </div>
        </div>`;
      }).join('')}
    </div>`}

    <div style="margin-top:12px;text-align:center">
      <button class="btn-sm" style="padding:8px 20px;font-size:13px;font-weight:700;background:var(--eest-orange);color:var(--eest-blue);border:none;border-radius:8px;cursor:pointer" onclick="addNewStudent()">+ Agregar alumno</button>
    </div>
    </div>

    <div class="curso-col-stats">
    <div class="stats-section">
      <button class="btn-stats-toggle" onclick="toggleStats()">📊 Estadísticas del mes</button>
      <div class="stats-body" id="statsBody" style="display:none">
        <div class="stats-month-picker">
          <label>Mes: <input type="month" id="statsMonth" value="${monthKey}" onchange="renderMonthlyStats(this.value)"></label>
        </div>
        <div id="statsTables"></div>
      </div>
    </div>
    </div>
    </div>
  `;
  renderMonthlyStats(monthKey);
  renderModal();
}

// ═══════════════════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════════════════

function fmtDate(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long" });
}

function toast(msg) {
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = msg;
  document.getElementById("toastContainer").appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

function esc(str) {
  if (!str) return '';
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

// ═══════════════════════════════════════════════════════════════
//  ACTIONS
// ═══════════════════════════════════════════════════════════════

function updateDate(val) {
  state.date = val;
  renderCursoContent();
}

function updateTurno(t) {
  state.turno = t;
  renderCursoContent();
}

function openModal(id) {
  state.selectedStudent = cachedStudents.find(s => s.id === id) || null;
  state.editingStudent = false;
  renderModal();
}

function closeModal() {
  state.selectedStudent = null;
  state.editingStudent = false;
  document.getElementById("modalOverlay").classList.remove("open");
}

function editStudent() {
  state.editingStudent = true;
  renderModal();
}

function cancelEdit() {
  state.editingStudent = false;
  renderModal();
}

function addNewStudent() {
  state.selectedStudent = { full_name: '', gender: 'M', dni: '', address: '', guardian_name: '', guardian_authorized: false, health_notes: '', course: state.currentCourseId, id: '' };
  state.editingStudent = true;
  renderModal();
}

async function saveStudentForm() {
  const s = state.selectedStudent;
  const form = document.getElementById("studentForm");
  const data = {
    full_name: form.full_name.value.trim(),
    gender: form.gender.value,
    dni: form.dni.value.trim() || null,
    address: form.address.value.trim() || null,
    guardian_name: form.guardian_name.value.trim() || null,
    guardian_authorized: form.guardian_authorized.checked,
    health_notes: form.health_notes.value.trim() || null,
    course: s.course || state.currentCourseId,
  };
  if (!data.full_name) { toast("El nombre es obligatorio"); return; }

  if (s.id) {
    await fdb.collection("students").doc(s.id).update(data);
    const idx = cachedStudents.findIndex(c => c.id === s.id);
    if (idx !== -1) cachedStudents[idx] = { ...cachedStudents[idx], ...data };
    toast("Alumno actualizado");
  } else {
    const ref = await fdb.collection("students").add(data);
    data.id = ref.id;
    cachedStudents.push({ id: ref.id, ...data });
  }

  state.editingStudent = false;
  closeModal();
  renderCursoContent();
}

document.getElementById("modalOverlay").addEventListener("click", (e) => {
  if (e.target === document.getElementById("modalOverlay")) closeModal();
});

function renderModal() {
  const s = state.selectedStudent;
  const overlay = document.getElementById("modalOverlay");
  const modal = document.getElementById("modal");
  if (!s) { overlay.classList.remove("open"); return; }

  if (state.editingStudent) {
    modal.innerHTML = `
      <div class="modal-header">
        <h2 class="modal-title">${s.id ? 'Editar alumno' : 'Agregar alumno'}</h2>
        <button class="modal-close" onclick="closeModal()">×</button>
      </div>
      <form id="studentForm" onsubmit="event.preventDefault();saveStudentForm()">
        <div class="form-group">
          <label>Nombre completo</label>
          <input type="text" name="full_name" value="${esc(s.full_name || '')}" required>
        </div>
        <div class="form-group">
          <label>Género</label>
          <select name="gender" style="width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:var(--radius-sm);font-size:14px;font-family:inherit">
            <option value="M" ${s.gender === 'M' ? 'selected' : ''}>Masculino</option>
            <option value="F" ${s.gender === 'F' ? 'selected' : ''}>Femenino</option>
          </select>
        </div>
        <div class="form-group">
          <label>DNI</label>
          <input type="text" name="dni" value="${esc(s.dni || '')}" placeholder="Opcional">
        </div>
        <div class="form-group">
          <label>Domicilio</label>
          <input type="text" name="address" value="${esc(s.address || '')}" placeholder="Opcional">
        </div>
        <div class="form-group">
          <label>Familiar a cargo</label>
          <input type="text" name="guardian_name" value="${esc(s.guardian_name || '')}" placeholder="Opcional">
        </div>
        <div class="form-group">
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
            <input type="checkbox" name="guardian_authorized" ${s.guardian_authorized ? 'checked' : ''}>
            Autorizado
          </label>
        </div>
        <div class="form-group">
          <label>Observaciones de salud</label>
          <textarea name="health_notes" rows="3" style="width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:var(--radius-sm);font-size:14px;font-family:inherit;resize:vertical">${esc(s.health_notes || '')}</textarea>
        </div>
        <div style="display:flex;gap:8px;margin-top:16px">
          <button type="button" class="btn" style="background:var(--muted);color:var(--text);flex:1" onclick="cancelEdit()">Cancelar</button>
          <button type="submit" class="btn" style="background:var(--eest-orange);color:var(--eest-blue);font-weight:700;flex:1">Guardar</button>
        </div>
      </form>
    `;
  } else {
    modal.innerHTML = `
      <div class="modal-header">
        <h2 class="modal-title">${esc(s.full_name)}</h2>
        <button class="modal-close" onclick="closeModal()">×</button>
      </div>
      <div class="ficha-row">
        <div class="ficha-icon">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 6a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2Z"/><path d="M8 11a2 2 0 1 0 4 0 2 2 0 0 0-4 0"/><path d="M16 11h2"/><path d="M16 15h2"/><path d="M10 15h8"/></svg>
        </div>
        <div><div class="ficha-label">DNI</div><div class="ficha-value">${esc(s.dni) || '—'}</div></div>
      </div>
      <div class="ficha-row">
        <div class="ficha-icon">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>
        </div>
        <div><div class="ficha-label">Domicilio</div><div class="ficha-value">${esc(s.address) || '—'}</div></div>
      </div>
      <div class="ficha-row">
        <div class="ficha-icon">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><polyline points="16 11 18 13 22 9"/></svg>
        </div>
        <div>
          <div class="ficha-label">Familiar a cargo</div>
          <div class="ficha-value">
            ${s.guardian_name
              ? `${esc(s.guardian_name)} ${s.guardian_authorized ? '✓ Autorizado' : '✗ NO autorizado'}`
              : '—'}
          </div>
        </div>
      </div>
      <div class="health-box ${s.health_notes ? 'has-notes' : 'no-notes'}">
        <div class="health-header">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg>
          Salud
        </div>
        <p style="font-size:14px">${esc(s.health_notes) || 'Sin observaciones'}</p>
      </div>
      <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn-sm" style="background:var(--eest-blue);color:#fff;border:none;padding:6px 14px" onclick="editStudent()">✏️ Editar</button>
        ${s.baja
          ? `<div style="padding:6px 10px;background:rgba(220,38,38,0.08);border:1px solid rgba(220,38,38,0.25);border-radius:8px;font-size:12px">
              <strong style="color:#991b1b">BAJA</strong> ${s.baja_date || ''}
              <button class="btn-sm" style="margin-left:6px" onclick="restoreBaja('${s.id}')">Restaurar</button>
             </div>`
          : `<button class="btn-sm btn-danger" onclick="markBaja('${s.id}')">Dar de baja</button>`
        }
      </div>
    `;
  }
  overlay.classList.add("open");
}

// ═══════════════════════════════════════════════════════════════
//  SAVE LIST
// ═══════════════════════════════════════════════════════════════

async function isSaved(courseId, date, turno) {
  const key = courseId + "|" + date + "|" + turno;
  const doc = await fdb.collection("savedLists").doc(key).get();
  return doc.exists;
}

function saveList() {
  const { currentCourseId, date, turno } = state;
  const key = currentCourseId + "|" + date + "|" + turno;
  const ref = fdb.collection("savedLists").doc(key);

  ref.get().then(doc => {
    if (doc.exists) {
      ref.delete().catch(() => {});
      toast("Lista desmarcada");
    } else {
      ref.set({
        savedAt: firebase.firestore.FieldValue.serverTimestamp(),
        by: authFB.currentUser?.email || "unknown"
      }).catch(() => {});
      toast("Lista guardada ✓");
    }
  }).catch(() => {});

  const btn = document.getElementById('btnSave');
  if (btn) {
    const wasSaved = btn.classList.contains('saved');
    btn.classList.toggle('saved');
    btn.textContent = wasSaved ? '💾 Guardar lista' : '✓ Guardada';
  }
}

// ═══════════════════════════════════════════════════════════════
//  MARK STATUS
// ═══════════════════════════════════════════════════════════════

function markStatus(studentId, status) {
  const { currentCourseId, date, turno } = state;
  const existing = currentStatusMap.get(studentId);

  if (existing === status) {
    currentStatusMap.delete(studentId);
    fdb.collection("attendance").doc(studentId + "_" + date + "_" + turno).delete().catch(() => {});
    toast("Marca borrada");
  } else {
    currentStatusMap.set(studentId, status);
    fdb.collection("attendance").doc(studentId + "_" + date + "_" + turno).set({
      student_id: studentId, date, turno, status,
      taken_by: authFB.currentUser?.email || "unknown",
      takenAt: firebase.firestore.FieldValue.serverTimestamp()
    }).catch(() => {});
    toast("Marcado " + status);
  }

  // Actualizar botones del alumno
  const card = document.querySelector(`.student-card[data-sid="${studentId}"]`);
  if (card) {
    card.querySelectorAll('.status-btn').forEach(b => {
      b.className = 'status-btn';
      const opt = b.textContent;
      const cur = currentStatusMap.get(studentId);
      if (cur === opt) b.classList.add('active-' + opt);
    });
  }

  // Actualizar totales
  const t = { P: 0, A: 0 };
  for (const st of currentStatusMap.values()) {
    if (st === "P") t.P++;
    else if (st === "A") t.A++;
  }
  document.querySelectorAll('.total-chip').forEach(chip => {
    const label = chip.querySelector('.total-chip-label')?.textContent;
    const val = chip.querySelector('.total-chip-value');
    if (val && label && label in t) val.textContent = t[label];
  });

  // Actualizar contador de registrados
  const reg = document.querySelector('.register-count strong:first-of-type');
  if (reg) reg.textContent = currentStatusMap.size;

  // Actualizar botón guardar
  const btn = document.getElementById('btnSave');
  if (btn) {
    btn.disabled = currentStatusMap.size === 0;
    btn.classList.remove('saved');
    btn.textContent = '💾 Guardar lista';
  }

  // Eliminar saved list en background si existe
  fdb.collection("savedLists").doc(currentCourseId + "|" + date + "|" + turno).get().then(sd => {
    if (sd.exists) sd.ref.delete();
  }).catch(() => {});
}

// ═══════════════════════════════════════════════════════════════
//  FERIADO / JORNADA
// ═══════════════════════════════════════════════════════════════

async function toggleFeriado() {
  const { date } = state;
  const ref = fdb.collection("specialDays").doc(date);
  const doc = await ref.get();
  let newType = null;
  if (doc.exists) {
    const type = doc.data().type;
    if (type === "feriado") {
      await ref.update({ type: "jornada" });
      newType = "jornada";
      toast("Marcado como Jornada");
    } else {
      await ref.delete();
      toast("Día normal");
    }
  } else {
    await ref.set({ type: "feriado", courseId: state.currentCourseId });
    newType = "feriado";
    toast("Marcado como Feriado");
  }

  const btn = document.querySelector('.btn-feriado');
  const banner = document.querySelector('.feriado-banner');
  const statusBtns = document.querySelectorAll('.status-btn');

  if (newType) {
    if (btn) { btn.textContent = newType.charAt(0).toUpperCase() + newType.slice(1); btn.className = 'btn-feriado active-' + newType; }
    if (!banner) {
      const hero = document.querySelector('.hero');
      if (hero) {
        const div = document.createElement('div');
        div.className = 'feriado-banner type-' + newType;
        div.innerHTML = '🚩 Día marcado como <strong>' + newType.toUpperCase() + '</strong> — No se toman asistencias';
        hero.appendChild(div);
      }
    } else { banner.className = 'feriado-banner type-' + newType; banner.innerHTML = '🚩 Día marcado como <strong>' + newType.toUpperCase() + '</strong> — No se toman asistencias'; }
    statusBtns.forEach(b => b.disabled = true);
  } else {
    if (btn) { btn.textContent = '🚩 Feriado'; btn.className = 'btn-feriado'; }
    if (banner) banner.remove();
    statusBtns.forEach(b => b.disabled = false);
  }
}

// ═══════════════════════════════════════════════════════════════
//  BAJA DE ALUMNO
// ═══════════════════════════════════════════════════════════════

async function markBaja(studentId) {
  const fecha = prompt("Fecha de baja (YYYY-MM-DD):", state.date);
  if (!fecha || !fecha.match(/^\d{4}-\d{2}-\d{2}$/)) { toast("Fecha inválida"); return; }
  await fdb.collection("students").doc(studentId).update({ baja: true, baja_date: fecha });
  const s = cachedStudents.find(c => c.id === studentId);
  if (s) { s.baja = true; s.baja_date = fecha; }
  toast("Alumno dado de baja");
  renderCursoContent();
}

async function restoreBaja(studentId) {
  if (!confirm("Restaurar este alumno?")) return;
  await fdb.collection("students").doc(studentId).update({ baja: false, baja_date: null });
  const s = cachedStudents.find(c => c.id === studentId);
  if (s) { s.baja = false; s.baja_date = null; }
  toast("Alumno restaurado");
  renderCursoContent();
}

// ═══════════════════════════════════════════════════════════════
//  ESTADÍSTICAS MENSUALES
// ═══════════════════════════════════════════════════════════════

let statsVisible = false;

function toggleStats() {
  statsVisible = !statsVisible;
  const body = document.getElementById("statsBody");
  const monthInput = document.getElementById("statsMonth");
  if (body) {
    body.style.display = statsVisible ? "block" : "none";
    if (statsVisible && monthInput) renderMonthlyStats(monthInput.value);
  }
}

function getDiasDelMes(month) {
  const [y, m] = month.split("-").map(Number);
  const days = [];
  const lastDay = new Date(y, m, 0).getDate();
  for (let d = 1; d <= lastDay; d++) {
    const date = new Date(y, m - 1, d);
    const dow = date.getDay();
    if (dow >= 1 && dow <= 5) days.push(month + (d < 10 ? "-0" : "-") + d);
  }
  return days;
}

async function renderMonthlyStats(month) {
  const el = document.getElementById("statsTables");
  if (!el) return;

  const courseId = state.currentCourseId;

  const studentsSnap = await fdb.collection("students").where("course", "==", courseId).get();
  const students = [];
  studentsSnap.forEach(doc => students.push({ id: doc.id, ...doc.data() }));

  const attSnap = await fdb.collection("attendance")
    .where("date", ">=", month + "-01")
    .where("date", "<=", month + "-31")
    .get();
  const allAttendance = [];
  attSnap.forEach(doc => allAttendance.push(doc.data()));

  const courseStudentIds = new Set(students.map(s => s.id));
  const attendance = allAttendance.filter(a => courseStudentIds.has(a.student_id));

  if (attendance.length === 0 && students.length === 0) {
    el.innerHTML = '<div class="stats-empty">No hay alumnos en este curso</div>';
    return;
  }

  if (attendance.length === 0) {
    el.innerHTML = '<div class="stats-empty">No se ha tomado asistencia este mes</div>';
    return;
  }

  const specialSnap = await fdb.collection("specialDays").get();
  const specialDays = {};
  specialSnap.forEach(doc => {
    if (doc.id.startsWith(month)) specialDays[doc.id] = doc.data();
  });

  const allDays = getDiasDelMes(month);
  const feriados = allDays.filter(d => specialDays[d]);
  const diasHabiles = allDays.length - feriados.length;

  function calcByGender(gender) {
    const sts = gender === "T" ? students : students.filter(s => s.gender === gender);
    const insc = sts.length;
    const ent = sts.filter(s => s.added_at && s.added_at.startsWith(month)).length;
    const sal = sts.filter(s => s.baja && s.baja_date && s.baja_date.startsWith(month)).length;
    const atts = gender === "T" ? attendance : attendance.filter(a => {
      const s = students.find(st => st.id === a.student_id);
      return s && s.gender === gender;
    });
    let totalAsis = 0, totalInas = 0;
    for (const a of atts) {
      if (a.status === "P" || a.status === "T") totalAsis += 1;
      else if (a.status === "A") totalInas += 1;
    }
    const asisMedia = diasHabiles > 0 ? (totalAsis / diasHabiles).toFixed(1) : "0.0";
    const pct = (totalAsis + totalInas) > 0 ? ((totalAsis * 100) / (totalAsis + totalInas)).toFixed(1) : "0.0";
    return { insc, ent, sal, totalAsis, totalInas, asisMedia, pct };
  }

  const stats = { M: calcByGender("M"), F: calcByGender("F"), T: calcByGender("T") };

  function row(label, getter) {
    return `<tr${label === "Total" || label === "Total General" ? ' class="total-row"' : ''}>
      <td>${label}</td>
      <td>${getter(stats.M)}</td>
      <td>${getter(stats.F)}</td>
      <td>${getter(stats.T)}</td>
    </tr>`;
  }

  el.innerHTML = `
    <div class="stats-section-title">📋 Movimiento de Estudiantes</div>
    <div class="stats-table-wrap">
      <table class="stats-table">
        <thead><tr><th></th><th>M</th><th>F</th><th>T</th></tr></thead>
        <tbody>
          ${row("Inscriptos", s => s.insc)}
          ${row("Entrados", s => s.ent)}
          ${row("Salidos", s => s.sal)}
        </tbody>
      </table>
    </div>

    <div class="stats-section-title">📊 Resumen de Asistencia</div>
    <div class="stats-table-wrap">
      <table class="stats-table">
        <thead><tr><th></th><th>M</th><th>F</th><th>T</th></tr></thead>
        <tbody>
          ${row("Total Asistencia", s => s.totalAsis)}
          ${row("Total Inasistencia", s => s.totalInas)}
          ${row("Asistencia Media", s => s.asisMedia)}
          ${row("% Asistencia", s => s.pct + "%")}
          <tr class="total-row"><td>Días Hábilies</td><td colspan="3">${diasHabiles}</td></tr>
          <tr class="total-row"><td>Días Feriados</td><td colspan="3">${feriados.length}</td></tr>
        </tbody>
      </table>
    </div>
    ${diasHabiles === 0 ? '<div class="stats-empty">No hay datos para este mes (0 días hábiles)</div>' : ''}
  `;
}

// ═══════════════════════════════════════════════════════════════
//  PERFIL
// ═══════════════════════════════════════════════════════════════

async function showProfile() {
  const user = authFB.currentUser;
  if (!user) return;
  const userDoc = await fdb.collection("users").doc(user.uid).get();
  const displayName = userDoc.exists
    ? (userDoc.data().full_name || user.displayName || user.email?.split("@")[0] || "Usuario")
    : (user.displayName || user.email?.split("@")[0] || "Usuario");
  const overlay = document.getElementById("modalOverlay");
  const modal = document.getElementById("modal");
  modal.innerHTML = `
    <div class="modal-header">
      <h2 class="modal-title">Mi Perfil</h2>
      <button class="modal-close" onclick="closeModal()">×</button>
    </div>
    <div class="profile-header">
      <img src="LOGO.webp" alt="" class="profile-avatar">
      <div class="profile-school">E.E.S.T. N°5</div>
      <div class="profile-name">${esc(displayName)}</div>
      <div class="profile-role">Preceptor/a</div>
    </div>
    <div class="profile-row">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
      <div><div style="font-weight:500">${esc(user.email || "")}</div></div>
    </div>
    <div class="profile-row">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
      <div><div style="font-weight:500">Turno: ${TURNO_LABEL[state.turno]}</div></div>
    </div>
    <div style="margin-top:16px">
      <button class="btn btn-primary" onclick="logout();closeModal()">Cerrar sesión</button>
    </div>
  `;
  overlay.classList.add("open");
}

// ═══════════════════════════════════════════════════════════════
//  MANUAL DE USO
// ═══════════════════════════════════════════════════════════════

function renderManual() {
  const el = document.getElementById("manualContent");
  if (!el) return;

  function mockup(html) {
    return `<div class="manual-mockup">${html}</div>`;
  }

  function step(num, title, desc, mock) {
    return `<div class="manual-card">
      <div class="manual-card-header"><span class="manual-step-num">${num}</span>${title}</div>
      <div class="manual-card-body">${desc}${mock ? mockup(mock) : ""}</div>
    </div>`;
  }

  el.innerHTML = `
    ${step(1, "Iniciar sesión / Registrarse",
      "Al abrir la app aparece la pantalla de login. Ingresá tu email y contraseña. Si es la primera vez, hacé clic en <strong>Registrarse</strong> y completá tu nombre.",
      `<svg width="280" height="140" viewBox="0 0 280 140"><rect width="280" height="140" fill="var(--card)" rx="8"/><rect x="90" y="10" width="100" height="20" rx="3" fill="var(--eest-blue)"/><rect x="20" y="40" width="240" height="12" rx="3" fill="var(--muted)"/><rect x="20" y="58" width="240" height="12" rx="3" fill="var(--muted)"/><rect x="60" y="80" width="160" height="16" rx="4" fill="var(--eest-orange)"/><text x="140" y="92" font-size="7" fill="#fff" text-anchor="middle" font-weight="bold">INGRESAR</text><text x="140" y="120" font-size="6" fill="var(--muted-foreground)" text-anchor="middle">¿No tenés cuenta? Registrarse</text></svg>`)}

    ${step(2, "Dashboard — Mis Cursos",
      "Después del login ves el <strong>Dashboard</strong> con todos los cursos. Cada curso aparece como una tarjeta con la cantidad de alumnos. Hacé clic en cualquier tarjeta para entrar. Si no hay cursos, tocá <strong>+ Agregar curso</strong> para crear uno nuevo.",
      `<svg width="280" height="140" viewBox="0 0 280 140"><rect width="280" height="140" fill="var(--card)" rx="8"/><text x="20" y="18" font-size="9" fill="var(--eest-blue)" font-weight="bold">Mis Cursos</text><rect x="14" y="28" width="120" height="90" rx="5" fill="var(--bg)"/><rect x="14" y="28" width="120" height="28" rx="5" fill="var(--eest-blue)"/><text x="24" y="46" font-size="9" fill="#fff" font-weight="bold">6° 1°</text><text x="24" y="70" font-size="6" fill="var(--muted-foreground)">👤 10 alumnos</text><text x="24" y="82" font-size="6" fill="var(--muted-foreground)">♂ 5  ♀ 5</text><rect x="24" y="95" width="40" height="12" rx="6" fill="var(--eest-orange)"/><text x="44" y="104" font-size="5" fill="#fff" text-anchor="middle" font-weight="bold">Ver lista</text><rect x="146" y="28" width="120" height="90" rx="5" fill="var(--bg)"/><rect x="146" y="28" width="120" height="28" rx="5" fill="var(--eest-blue)"/><text x="156" y="46" font-size="9" fill="#fff" font-weight="bold">5° 2°</text><text x="156" y="70" font-size="6" fill="var(--muted-foreground)">👤 0 alumnos</text><text x="156" y="82" font-size="6" fill="var(--muted-foreground)">♂ 0  ♀ 0</text><rect x="156" y="95" width="40" height="12" rx="6" fill="var(--eest-orange)"/><text x="176" y="104" font-size="5" fill="#fff" text-anchor="middle" font-weight="bold">Ver lista</text><rect x="14" y="118" width="252" height="16" rx="4" fill="none" stroke="var(--border)" stroke-dasharray="4,3"/><text x="140" y="130" font-size="7" fill="var(--muted-foreground)" text-anchor="middle">+ Agregar curso</text></svg>`)}

    ${step(3, "Crear un curso nuevo",
      "En el Dashboard, tocá la tarjeta con borde punteado <strong>+ Agregar curso</strong>. Ingresá el nombre (ej: 5° 2°) y confirmá. El curso aparece al instante en el dashboard. Entrá a él para empezar a cargar alumnos.",
      `<svg width="280" height="130" viewBox="0 0 280 130"><rect width="280" height="130" fill="var(--card)" rx="8"/><rect x="20" y="10" width="240" height="110" rx="6" fill="var(--bg)"/><text x="35" y="32" font-size="10" fill="var(--eest-blue)" font-weight="bold">Agregar curso</text><text x="35" y="50" font-size="7" fill="var(--text-secondary)" font-weight="600">Nombre del curso</text><rect x="35" y="54" width="210" height="20" rx="4" fill="var(--card)" stroke="var(--border)"/><text x="42" y="68" font-size="7" fill="var(--muted-foreground)">Ej: 5° 2°</text><rect x="155" y="84" width="90" height="22" rx="4" fill="var(--eest-orange)"/><text x="200" y="98" font-size="8" fill="var(--eest-blue)" text-anchor="middle" font-weight="bold">Crear curso</text><rect x="35" y="84" width="90" height="22" rx="4" fill="var(--muted)"/><text x="80" y="98" font-size="8" fill="var(--muted-foreground)" text-anchor="middle">Cancelar</text></svg>`)}

    ${step(4, "Elegir fecha y turno",
      "En la parte superior de la lista seleccioná la <strong>fecha</strong> y el <strong>turno</strong> (Mañana / Tarde / Noche). El turno se autoselecciona según la hora actual.",
      `<svg width="280" height="110" viewBox="0 0 280 110"><rect width="280" height="110" fill="var(--card)" rx="8"/><rect x="20" y="10" width="240" height="90" rx="8" fill="var(--eest-blue)"/><text x="35" y="28" font-size="6" fill="rgba(255,255,255,.7)">CURSO</text><text x="35" y="42" font-size="14" fill="#fff" font-weight="bold">6° 1°</text><rect x="160" y="20" width="40" height="22" rx="4" fill="rgba(255,255,255,.15)"/><text x="180" y="34" font-size="8" fill="#fff" text-anchor="middle">P 0</text><rect x="205" y="20" width="40" height="22" rx="4" fill="rgba(255,255,255,.15)"/><text x="225" y="34" font-size="8" fill="#fff" text-anchor="middle">A 0</text><rect x="35" y="55" width="100" height="12" rx="3" fill="rgba(255,255,255,.15)"/><text x="40" y="63" font-size="6" fill="#fff">Fecha: 2026-06-04</text><rect x="145" y="55" width="50" height="12" rx="3" fill="var(--eest-orange)"/><text x="170" y="63" font-size="6" fill="var(--eest-blue)" font-weight="bold">Mañana</text></svg>`)}

    ${step(5, "Marcar asistencia",
      "Cada alumno tiene 2 botones: <strong>P</strong> (Presente) y <strong>A</strong> (Ausente). Tocá el que corresponda. Si volvés a tocar el mismo, se borra la marca.",
      `<svg width="280" height="130" viewBox="0 0 280 130"><rect width="280" height="130" fill="var(--card)" rx="8"/><rect x="20" y="12" width="240" height="36" rx="6" fill="var(--bg)"/><text x="68" y="30" font-size="8" fill="var(--eest-blue)" font-weight="bold">1 García, Lautaro</text><rect x="150" y="16" width="28" height="28" rx="4" fill="var(--success)"/><text x="164" y="34" font-size="8" fill="#fff" text-anchor="middle" font-weight="bold">P</text><rect x="182" y="16" width="28" height="28" rx="4" fill="transparent" stroke="var(--border)"/><text x="196" y="34" font-size="8" fill="var(--text-secondary)" text-anchor="middle" font-weight="bold">A</text><rect x="20" y="56" width="240" height="36" rx="6" fill="var(--bg)"/><text x="68" y="74" font-size="8" fill="var(--eest-orange)" font-weight="bold">2 Martínez, Sofía</text><rect x="150" y="60" width="28" height="28" rx="4" fill="transparent" stroke="var(--border)"/><text x="164" y="78" font-size="8" fill="var(--text-secondary)" text-anchor="middle" font-weight="bold">P</text><rect x="182" y="60" width="28" height="28" rx="4" fill="var(--destructive)"/><text x="196" y="78" font-size="8" fill="#fff" text-anchor="middle" font-weight="bold">A</text></svg>`)}

    ${step(6, "Guardar lista",
      "Cuando termines de marcar, tocá <strong>💾 Guardar lista</strong>. Si después modificás alguna marca, la lista se desmarca automáticamente para que la guardes de nuevo. Al lado tenés <strong>🚩 Feriado</strong> y <strong>⚙️ Gestión</strong>.",
      `<svg width="280" height="70" viewBox="0 0 280 70"><rect width="280" height="70" fill="var(--card)" rx="8"/><rect x="20" y="20" width="100" height="30" rx="6" fill="var(--eest-orange)"/><text x="70" y="39" font-size="9" fill="var(--eest-blue)" text-anchor="middle" font-weight="bold">💾 Guardar</text><rect x="130" y="20" width="60" height="30" rx="6" fill="rgba(220,38,38,.15)" stroke="rgba(220,38,38,.3)"/><text x="160" y="39" font-size="9" fill="#991b1b" text-anchor="middle" font-weight="bold">🚩 Feriado</text><rect x="200" y="20" width="60" height="30" rx="6" fill="rgba(255,255,255,.12)" stroke="rgba(255,255,255,.2)"/><text x="230" y="39" font-size="9" fill="var(--eest-blue)" text-anchor="middle" font-weight="bold">⚙️ Gestión</text></svg>`)}

    ${step(7, "Gestión del curso",
      "El botón <strong>⚙️ Gestión</strong> (al lado de Guardar y Feriado) abre un menú con varias opciones:<br><br>"
      + "<strong>✏️ Editar curso</strong> — Cambiar el nombre del curso. Todos los alumnos se actualizan automáticamente.<br>"
      + "<strong>📥 Importar alumnos</strong> — Copiar alumnos de otro curso. Seleccionás el curso origen, marcás los alumnos y se agregan al curso actual sin eliminar el original.<br>"
      + "<strong>➕ Agregar alumno</strong> — Añadir un alumno nuevo al curso.<br>"
      + "<strong>🗑️ Eliminar alumno</strong> — Seleccionar y borrar alumnos del curso (con todos sus registros de asistencia).<br>"
      + "<strong>🗑️ Eliminar curso</strong> — Borra el curso entero con todos sus alumnos y asistencias.",
      `<svg width="280" height="200" viewBox="0 0 280 200"><rect width="280" height="200" fill="var(--card)" rx="8"/><text x="20" y="22" font-size="11" fill="var(--eest-blue)" font-weight="bold">Gestión del curso</text><rect x="14" y="32" width="252" height="28" rx="4" fill="var(--bg)" stroke="var(--border)"/><text x="24" y="48" font-size="8" fill="var(--eest-orange)" font-weight="bold">✏️</text><text x="42" y="48" font-size="9" fill="var(--text)" font-weight="600">Editar curso</text><text x="42" y="56" font-size="6" fill="var(--muted-foreground)">Cambiar nombre del curso</text><rect x="14" y="64" width="252" height="28" rx="4" fill="var(--bg)" stroke="var(--border)"/><text x="24" y="80" font-size="8" font-weight="bold">📥</text><text x="42" y="80" font-size="9" fill="var(--text)" font-weight="600">Importar alumnos</text><text x="42" y="88" font-size="6" fill="var(--muted-foreground)">Copiar alumnos de otro curso</text><rect x="14" y="96" width="252" height="28" rx="4" fill="var(--bg)" stroke="var(--border)"/><text x="24" y="112" font-size="8" font-weight="bold">➕</text><text x="42" y="112" font-size="9" fill="var(--text)" font-weight="600">Agregar alumno</text><text x="42" y="120" font-size="6" fill="var(--muted-foreground)">Añadir alumno nuevo al curso</text><rect x="14" y="128" width="252" height="28" rx="4" fill="var(--bg)" stroke="rgba(220,38,38,0.25)"/><text x="24" y="144" font-size="8" fill="var(--destructive)" font-weight="bold">🗑️</text><text x="42" y="144" font-size="9" fill="var(--destructive)" font-weight="600">Eliminar alumno</text><text x="42" y="152" font-size="6" fill="var(--destructive)">Borrar alumnos del curso</text><rect x="14" y="160" width="252" height="28" rx="4" fill="var(--bg)" stroke="rgba(220,38,38,0.25)"/><text x="24" y="176" font-size="8" fill="var(--destructive)" font-weight="bold">🗑️</text><text x="42" y="176" font-size="9" fill="var(--destructive)" font-weight="600">Eliminar curso</text><text x="42" y="184" font-size="6" fill="var(--destructive)">Borrar el curso entero</text></svg>`)}

    ${step(8, "Ver perfil del alumno",
      "Tocá el nombre del alumno para ver su <strong>ficha completa</strong>: DNI, domicilio, familiar a cargo y observaciones de salud. Desde ahí podés editarlo o darlo de baja.",
      `<svg width="280" height="140" viewBox="0 0 280 140"><rect width="280" height="140" fill="var(--card)" rx="8"/><rect x="20" y="10" width="240" height="120" rx="6" fill="var(--bg)"/><text x="35" y="30" font-size="11" fill="var(--eest-blue)" font-weight="bold">Lautaro García</text><rect x="230" y="12" width="18" height="18" rx="3" fill="transparent"/><text x="239" y="25" font-size="12" fill="var(--muted-foreground)" text-anchor="middle">×</text><text x="35" y="50" font-size="8" fill="var(--muted-foreground)">DNI</text><text x="35" y="62" font-size="10" font-weight="500">45.123.456</text><text x="35" y="80" font-size="8" fill="var(--muted-foreground)">Domicilio</text><text x="35" y="92" font-size="10" font-weight="500">—</text><text x="35" y="110" font-size="8" fill="var(--muted-foreground)">Familiar a cargo</text><text x="35" y="122" font-size="10" font-weight="500">—</text></svg>`)}

    ${step(9, "Agregar / Editar alumno",
      "Usá el botón <strong>+ Agregar alumno</strong> debajo de la lista (o desde ⚙️ Gestión) para incorporar un estudiante nuevo. Para modificar datos, abrí su perfil y tocá <strong>✏️ Editar</strong>.",
      `<svg width="280" height="70" viewBox="0 0 280 70"><rect width="280" height="70" fill="var(--card)" rx="8"/><rect x="65" y="20" width="150" height="30" rx="6" fill="var(--eest-orange)"/><text x="140" y="39" font-size="9" fill="var(--eest-blue)" text-anchor="middle" font-weight="bold">+ Agregar alumno</text></svg>`)}

    ${step(10, "Dar de baja",
      "Si un alumno egresa, entrá a su perfil y tocá <strong>Dar de baja</strong>. Ingresá la fecha. El alumno se marca con 🚫 BAJA y sus botones de asistencia se bloquean. Podés restaurarlo después.",
      `<svg width="280" height="70" viewBox="0 0 280 70"><rect width="280" height="70" fill="var(--card)" rx="8"/><rect x="20" y="20" width="100" height="30" rx="4" fill="var(--destructive)"/><text x="70" y="39" font-size="9" fill="#fff" text-anchor="middle" font-weight="bold">Dar de baja</text><text x="135" y="39" font-size="9" fill="var(--muted-foreground">o</text><rect x="155" y="20" width="80" height="30" rx="4" fill="var(--eest-blue)"/><text x="195" y="39" font-size="9" fill="#fff" text-anchor="middle" font-weight="bold">✏️ Editar</text></svg>`)}

    ${step(11, "Marcar Feriado / Jornada",
      "Al lado del botón Guardar está <strong>🚩 Feriado</strong>. Tocá para marcar el día como Feriado. Volvé a tocar para cambiarlo a Jornada, y otra vez para desmarcarlo. Los botones de asistencia se deshabilitan automáticamente.",
      `<svg width="280" height="80" viewBox="0 0 280 80"><rect width="280" height="80" fill="var(--card)" rx="8"/><rect x="20" y="20" width="100" height="30" rx="6" fill="var(--eest-orange)"/><text x="70" y="39" font-size="9" fill="var(--eest-blue)" text-anchor="middle" font-weight="bold">💾 Guardar</text><rect x="130" y="20" width="70" height="30" rx="6" fill="rgba(220,38,38,0.15)" stroke="rgba(220,38,38,0.3)"/><text x="165" y="39" font-size="9" fill="#991b1b" text-anchor="middle" font-weight="bold">🚩 Feriado</text><rect x="210" y="20" width="50" height="30" rx="6" fill="rgba(255,255,255,.12)" stroke="rgba(255,255,255,.2)"/><text x="235" y="39" font-size="8" fill="var(--eest-blue)" text-anchor="middle" font-weight="bold">⚙️</text><rect x="20" y="56" width="240" height="18" rx="4" fill="rgba(220,38,38,0.08)"/><text x="140" y="68" font-size="6" fill="#991b1b" text-anchor="middle" font-weight="600">🚩 Día marcado como FERIADO — No se toman asistencias</text></svg>`)}

    ${step(12, "Estadísticas mensuales",
      "Al final de la lista de alumnos hay un botón <strong>📊 Estadísticas del mes</strong>. Muestra dos tablas con desglose por género (M/F/Total): movimiento de estudiantes y resumen de asistencia con Asistencia Media y % de Asistencia. Solo muestra datos del curso actual.",
      `<svg width="280" height="150" viewBox="0 0 280 150"><rect width="280" height="150" fill="var(--card)" rx="8"/><text x="20" y="18" font-size="8" fill="var(--eest-blue)" font-weight="bold">📋 Movimiento de Estudiantes</text><rect x="14" y="24" width="252" height="50" rx="4" fill="var(--bg)"/><rect x="14" y="24" width="50" height="16" rx="3" fill="var(--eest-blue)"/><text x="22" y="35" font-size="6" fill="#fff">#</text><rect x="64" y="24" width="50" height="16" rx="3" fill="var(--eest-blue)"/><text x="72" y="35" font-size="6" fill="#fff">M</text><rect x="114" y="24" width="50" height="16" rx="3" fill="var(--eest-blue)"/><text x="122" y="35" font-size="6" fill="#fff">F</text><rect x="164" y="24" width="50" height="16" rx="3" fill="var(--eest-blue)"/><text x="172" y="35" font-size="6" fill="#fff">T</text><text x="22" y="52" font-size="7" fill="var(--text)">Inscriptos</text><text x="80" y="52" font-size="7" fill="var(--text)" text-anchor="middle">5</text><text x="130" y="52" font-size="7" fill="var(--text)" text-anchor="middle">5</text><text x="180" y="52" font-size="7" fill="var(--text)" text-anchor="middle">10</text><text x="22" y="65" font-size="7" fill="var(--text)">Asistencia</text><text x="80" y="65" font-size="7" fill="var(--text)" text-anchor="middle">4</text><text x="130" y="65" font-size="7" fill="var(--text)" text-anchor="middle">4</text><text x="180" y="65" font-size="7" fill="var(--text)" text-anchor="middle">8</text><text x="20" y="90" font-size="8" fill="var(--eest-blue)" font-weight="bold">📊 Resumen de Asistencia</text><rect x="14" y="96" width="252" height="44" rx="4" fill="var(--bg)"/><rect x="14" y="96" width="50" height="14" rx="3" fill="var(--eest-blue)"/><text x="22" y="106" font-size="6" fill="#fff">#</text><rect x="64" y="96" width="50" height="14" rx="3" fill="var(--eest-blue)"/><text x="72" y="106" font-size="6" fill="#fff">M</text><rect x="114" y="96" width="50" height="14" rx="3" fill="var(--eest-blue)"/><text x="122" y="106" font-size="6" fill="#fff">F</text><rect x="164" y="96" width="50" height="14" rx="3" fill="var(--eest-blue)"/><text x="172" y="106" font-size="6" fill="#fff">T</text><text x="22" y="122" font-size="7" fill="var(--text)">% Asistencia</text><text x="80" y="122" font-size="7" fill="var(--success)" text-anchor="middle" font-weight="bold">80%</text><text x="130" y="122" font-size="7" fill="var(--success)" text-anchor="middle" font-weight="bold">80%</text><text x="180" y="122" font-size="7" fill="var(--success)" text-anchor="middle" font-weight="bold">80%</text><text x="22" y="135" font-size="6" fill="var(--muted-foreground)">Días hábiles: 22  |  Feriados: 2</text></svg>`)}

    ${step(13, "Planilla mensual de asistencia",
      "Andá a la pestaña <strong>Informe</strong> del menú inferior. Seleccioná <strong>Año</strong>, <strong>Mes</strong> y <strong>Curso</strong> (o «Todos los cursos»). Se muestra la planilla con los alumnos y los días del mes como columnas. Cada celda muestra <strong>P</strong> (Presente) o <strong>A</strong> (Ausente). Las columnas finales muestran el total calculado (cada turno = 0.5). Usá el buscador para resaltar un alumno. Hacé clic en una fila para ver el detalle; volvé a clicar para cerrar.",
      `<svg width="280" height="140" viewBox="0 0 280 140"><rect width="280" height="140" fill="var(--card)" rx="8"/><text x="14" y="18" font-size="8" fill="var(--eest-blue)" font-weight="bold">Junio 2026 — 6° 1°</text><rect x="14" y="24" width="252" height="110" rx="4" fill="var(--bg)"/><rect x="14" y="24" width="28" height="16" rx="2" fill="var(--eest-blue)"/><text x="18" y="35" font-size="5" fill="#fff">#</text><rect x="42" y="24" width="60" height="16" rx="2" fill="var(--eest-blue)"/><text x="48" y="35" font-size="5" fill="#fff">Nombre</text><rect x="102" y="24" width="14" height="16" rx="2" fill="var(--eest-blue)"/><text x="105" y="35" font-size="5" fill="#fff">1</text><rect x="116" y="24" width="14" height="16" rx="2" fill="var(--eest-blue)"/><text x="119" y="35" font-size="5" fill="#fff">2</text><rect x="130" y="24" width="14" height="16" rx="2" fill="var(--eest-blue)"/><text x="133" y="35" font-size="5" fill="#fff">3</text><rect x="144" y="24" width="14" height="16" rx="2" fill="var(--eest-blue)"/><text x="147" y="35" font-size="5" fill="#fff">4</text><rect x="158" y="24" width="14" height="16" rx="2" fill="var(--eest-blue)"/><text x="161" y="35" font-size="5" fill="#fff">5</text><rect x="176" y="24" width="14" height="16" rx="2" fill="var(--eest-blue)"/><text x="179" y="35" font-size="5" fill="#fff">6</text><rect x="194" y="24" width="14" height="16" rx="2" fill="var(--eest-blue)"/><text x="197" y="35" font-size="5" fill="#fff">7</text><rect x="212" y="24" width="16" height="16" rx="2" fill="var(--eest-blue)"/><text x="215" y="35" font-size="5" fill="#fff">8</text><rect x="232" y="24" width="16" height="16" rx="2" fill="var(--eest-blue)"/><text x="235" y="35" font-size="5" fill="#fff">9</text><rect x="14" y="44" width="28" height="18" rx="0" fill="var(--card)"/><text x="28" y="56" font-size="5" fill="var(--muted-foreground)" text-anchor="middle">1</text><rect x="42" y="44" width="60" height="18" rx="0" fill="var(--card)"/><text x="48" y="56" font-size="6" fill="var(--text)">Pérez, Juan</text><rect x="102" y="44" width="14" height="18" rx="0"/><rect x="102" y="44" width="14" height="18" rx="0" fill="rgba(22,163,74,0.18)"/><text x="109" y="56" font-size="6" fill="var(--success)" text-anchor="middle" font-weight="bold">P</text><rect x="116" y="44" width="14" height="18" rx="0"/><rect x="116" y="44" width="14" height="18" rx="0" fill="rgba(22,163,74,0.18)"/><text x="123" y="56" font-size="6" fill="var(--success)" text-anchor="middle" font-weight="bold">P</text><rect x="130" y="44" width="14" height="18" rx="0" fill="rgba(220,38,38,0.15)"/><text x="137" y="56" font-size="6" fill="var(--destructive)" text-anchor="middle" font-weight="bold">A</text><rect x="144" y="44" width="14" height="18" rx="0" fill="rgba(22,163,74,0.18)"/><text x="151" y="56" font-size="6" fill="var(--success)" text-anchor="middle" font-weight="bold">P</text><rect x="158" y="44" width="14" height="18" rx="0" fill="rgba(22,163,74,0.18)"/><text x="165" y="56" font-size="6" fill="var(--success)" text-anchor="middle" font-weight="bold">P</text><rect x="176" y="44" width="14" height="18" rx="0"/><rect x="176" y="44" width="14" height="18" rx="0"/><text x="183" y="56" font-size="6" fill="var(--muted-foreground)" text-anchor="middle">-</text><rect x="194" y="44" width="14" height="18" rx="0" fill="rgba(22,163,74,0.18)"/><text x="201" y="56" font-size="6" fill="var(--success)" text-anchor="middle" font-weight="bold">P</text><rect x="212" y="44" width="16" height="18" rx="0" fill="rgba(220,38,38,0.15)"/><text x="220" y="56" font-size="6" fill="var(--destructive)" text-anchor="middle" font-weight="bold">A</text><rect x="232" y="44" width="16" height="18" rx="0" fill="rgba(22,163,74,0.18)"/><text x="240" y="56" font-size="6" fill="var(--success)" text-anchor="middle" font-weight="bold">P</text><rect x="14" y="62" width="28" height="18" rx="0" fill="var(--muted)"/><text x="28" y="74" font-size="5" fill="var(--muted-foreground)" text-anchor="middle">2</text><rect x="42" y="62" width="60" height="18" rx="0" fill="var(--muted)"/><text x="48" y="74" font-size="6" fill="var(--text)">García, M.</text><rect x="102" y="62" width="14" height="18" rx="0" fill="rgba(22,163,74,0.18)"/><text x="109" y="74" font-size="6" fill="var(--success)" text-anchor="middle" font-weight="bold">P</text><rect x="116" y="62" width="14" height="18" rx="0" fill="rgba(22,163,74,0.18)"/><text x="123" y="74" font-size="6" fill="var(--success)" text-anchor="middle" font-weight="bold">P</text><rect x="130" y="62" width="14" height="18" rx="0" fill="rgba(22,163,74,0.18)"/><text x="137" y="74" font-size="6" fill="var(--success)" text-anchor="middle" font-weight="bold">P</text><rect x="144" y="62" width="14" height="18" rx="0"/><rect x="144" y="62" width="14" height="18" rx="0"/><text x="151" y="74" font-size="6" fill="var(--muted-foreground)" text-anchor="middle">-</text><rect x="158" y="62" width="14" height="18" rx="0" fill="rgba(22,163,74,0.18)"/><text x="165" y="74" font-size="6" fill="var(--success)" text-anchor="middle" font-weight="bold">P</text><rect x="176" y="62" width="14" height="18" rx="0" fill="rgba(22,163,74,0.18)"/><text x="183" y="74" font-size="6" fill="var(--success)" text-anchor="middle" font-weight="bold">P</text><rect x="194" y="62" width="14" height="18" rx="0" fill="rgba(220,38,38,0.15)"/><text x="201" y="74" font-size="6" fill="var(--destructive)" text-anchor="middle" font-weight="bold">A</text><rect x="212" y="62" width="16" height="18" rx="0"/><rect x="212" y="62" width="16" height="18" rx="0"/><text x="220" y="74" font-size="6" fill="var(--muted-foreground)" text-anchor="middle">-</text><rect x="232" y="62" width="16" height="18" rx="0" fill="rgba(22,163,74,0.18)"/><text x="240" y="74" font-size="6" fill="var(--success)" text-anchor="middle" font-weight="bold">P</text><text x="14" y="96" font-size="6" fill="var(--muted-foreground)">📅 Año: 2026 | Mes: Junio | Curso: 6° 1°</text><text x="14" y="110" font-size="6" fill="var(--muted-foreground)">🔍 Buscar alumno...</text><rect x="14" y="114" width="150" height="14" rx="3" fill="var(--card)" stroke="var(--border)"/></svg>`)}
  `;
}

// ═══════════════════════════════════════════════════════════════
//  INFORME DE ASISTENCIAS — PLANILLA MENSUAL
// ═══════════════════════════════════════════════════════════════

let informeStudents = [];
let informeSelectedId = null;
let informeAttData = {};
let informeAttByDate = {};
let informeEmptyMode = false;

const MES_NOM = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];

function getYearOpts(s) {
  const y = new Date().getFullYear();
  return [y - 1, y, y + 1].map(yy => `<option value="${yy}" ${yy == s ? "selected" : ""}>${yy}</option>`).join("");
}

function getMonthOpts(s) {
  return MES_NOM.map((m, i) => {
    const v = String(i + 1).padStart(2, "0");
    return `<option value="${v}" ${v === s ? "selected" : ""}>${m}</option>`;
  }).join("");
}

async function renderInforme() {
  const el = document.getElementById("informeContent");
  if (!el) return;
  const now = new Date();
  const year = state.date.slice(0, 4);
  const month = String(now.getMonth() + 1).padStart(2, "0");

  const coursesSnap = await fdb.collection("courses").get();
  const courses = [];
  coursesSnap.forEach(doc => courses.push({ id: doc.id, ...doc.data() }));

  el.innerHTML = `
    <div class="informe-grid">
      <div class="informe-side">
        <div class="informe-controls">
          <label>📅 Año</label>
          <select id="informeYear" onchange="loadInforme()">${getYearOpts(+year)}</select>
          <label style="margin-top:6px">Mes</label>
          <select id="informeMonth" onchange="loadInforme()">${getMonthOpts(month)}</select>
          <label style="margin-top:6px">Curso</label>
          <select id="informeCourse" onchange="loadInforme()">
            <option value="">Todos los cursos</option>
            ${courses.map(c => `<option value="${esc(c.name)}">${esc(c.name)}</option>`).join('')}
          </select>
        </div>
        <div class="informe-empty-toggle">
          <label class="toggle-switch">
            <input type="checkbox" id="informeEmptyToggle" onchange="toggleInformeEmptyMode(this.checked)">
            <span class="toggle-slider"></span>
          </label>
          <span>Modo vacío</span>
        </div>
        <div class="informe-search">
          <input type="text" id="informeSearchInput" placeholder="🔍 Buscar alumno..." oninput="filterInformeStudents()">
        </div>
      </div>
      <div class="informe-main" id="informeMain">
        <div class="loading">Cargando planilla...</div>
      </div>
      <div class="informe-detail" id="infDet"></div>
    </div>
  `;
  await loadInforme();
}

async function loadInforme() {
  try {
    const year = document.getElementById("informeYear")?.value;
    const month = document.getElementById("informeMonth")?.value;
    const course = document.getElementById("informeCourse")?.value;
    if (!year || !month) return;
    const lastDay = new Date(+year, +month, 0).getDate();
    const monthStr = year + "-" + month;

    const snap = await fdb.collection("students").get();
    informeStudents = [];
    snap.forEach(d => {
      const data = { id: d.id, ...d.data() };
      if (course && data.course !== course) return;
      informeStudents.push(data);
    });

    const attSnap = await fdb.collection("attendance")
      .where("date", ">=", monthStr + "-01")
      .where("date", "<=", monthStr + "-" + String(lastDay).padStart(2, "0"))
      .get();

    informeAttData = {};
    informeAttByDate = {};
    attSnap.forEach(doc => {
      const d = doc.data();
      if (!informeAttData[d.student_id]) informeAttData[d.student_id] = [];
      informeAttData[d.student_id].push(d);
      const k = d.student_id + "|" + d.date;
      if (!informeAttByDate[k]) informeAttByDate[k] = [];
      informeAttByDate[k].push(d);
    });

    renderPlanilla(informeStudents, monthStr, lastDay);
  } catch (e) { console.error(e); toast("Error al cargar planilla"); }
}

function cellHTML(studentId, dateStr) {
  if (informeEmptyMode) return "";
  const key = studentId + "|" + dateStr;
  const recs = informeAttByDate[key];
  if (!recs || recs.length === 0) return "";
  const hasPresente = recs.some(r => r.status === "P" || r.status === "T");
  const hasAusente = recs.some(r => r.status === "A");
  if (hasPresente) return `<span class="cs cs-P">P</span>`;
  if (hasAusente) return `<span class="cs cs-A">A</span>`;
  return "";
}

function calcP(studentId) {
  if (informeEmptyMode) return { p: "0.0", a: "0.0" };
  const recs = informeAttData[studentId] || [];
  const byDate = {};
  recs.forEach(r => {
    const d = new Date(r.date + "T00:00:00");
    if (d.getDay() === 0 || d.getDay() === 6) return;
    if (!byDate[r.date]) byDate[r.date] = [];
    byDate[r.date].push(r);
  });
  let p = 0, a = 0;
  for (const arr of Object.values(byDate)) {
    for (const r of arr) {
      if (r.status === "P" || r.status === "T") p += 0.5;
      else if (r.status === "A") a += 0.5;
    }
  }
  return { p: p.toFixed(1), a: a.toFixed(1) };
}

function renderPlanilla(students, monthStr, lastDay) {
  const el = document.getElementById("informeMain");
  if (!el) return;
  const [y, mn] = monthStr.split("-");
  const mName = MES_NOM[parseInt(mn) - 1];

  const dayNumbers = [];
  for (let d = 1; d <= lastDay; d++) {
    const dow = new Date(+y, +mn - 1, d).getDay();
    if (dow === 0 || dow === 6) continue;
    dayNumbers.push(d);
  }

  let daysTH = dayNumbers.map(d => `<th>${d}</th>`).join("");

  const rows = students.map((s, i) => {
    const nl = s.full_name.toLowerCase();
    const tot = calcP(s.id);
    let cells = dayNumbers.map(d => {
      const ds = monthStr + "-" + String(d).padStart(2, "0");
      return `<td>${cellHTML(s.id, ds)}</td>`;
    }).join("");
    return `<tr class="ir${s.id === informeSelectedId ? ' sel' : ''}" data-sid="${s.id}" data-name="${esc(nl)}" onclick="selInf('${s.id}')">
      <td class="rn">${i + 1}</td>
      <td class="rnm">${esc(s.full_name)}</td>
      ${cells}
      <td class="tp">${tot.p}</td>
      <td class="ta">${tot.a}</td>
    </tr>`;
  }).join("");

  el.innerHTML = `
    <div class="ph">
      <h3>${mName} ${y}</h3>
      <span class="pc">${students.length} alumnos</span>
    </div>
    <div class="informe-table-wrap pw">
      <table class="informe-table pt" id="infTable">
        <thead><tr>
          <th class="cn">#</th>
          <th class="cnm">Nombre</th>
          ${daysTH}
          <th class="ct">P</th>
          <th class="ct">A</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
  if (informeSelectedId) renderDet(informeSelectedId);
}

function filterInformeStudents() {
  const q = document.getElementById("informeSearchInput")?.value.toLowerCase().trim();
  const rows = document.querySelectorAll("#infTable .ir");
  if (!rows) return;
  let first = null;
  rows.forEach(r => {
    r.classList.remove("highlight");
    if (q && r.dataset.name.includes(q)) {
      r.classList.add("highlight");
      if (!first) first = r.dataset.sid;
    }
  });
  if (q && first) selInf(first);
  else if (!q) deselectInf();
}

function deselectInf() {
  informeSelectedId = null;
  document.querySelectorAll(".ir").forEach(r => r.classList.remove("sel"));
  const det = document.getElementById("infDet");
  if (det) det.innerHTML = "";
}

function toggleInformeEmptyMode(checked) {
  informeEmptyMode = checked;
  const year = document.getElementById("informeYear")?.value;
  const month = document.getElementById("informeMonth")?.value;
  if (!year || !month) return;
  const lastDay = new Date(+year, +month, 0).getDate();
  renderPlanilla(informeStudents, year + "-" + month, lastDay);
}

async function selInf(id) {
  if (informeSelectedId === id) { deselectInf(); return; }
  informeSelectedId = id;
  document.querySelectorAll(".ir").forEach(r => r.classList.remove("sel"));
  const r = document.querySelector(`.ir[data-sid="${id}"]`);
  if (r) r.classList.add("sel");
  renderDet(id);
}

document.addEventListener("click", function(e) {
  if (!informeSelectedId) return;
  if (!e.target.closest(".ir") && !e.target.closest("#infDet") && !e.target.closest(".informe-search")) {
    deselectInf();
  }
});

function renderDet(studentId) {
  const el = document.getElementById("infDet");
  if (!el) return;
  const s = informeStudents.find(x => x.id === studentId);
  if (!s) { el.innerHTML = ""; return; }
  const recs = informeAttData[studentId];
  if (!recs || !recs.length) { el.innerHTML = '<div class="informe-empty">Sin registros este mes</div>'; return; }

  const sorted = [...recs].sort((a, b) => a.date.localeCompare(b.date) || a.turno.localeCompare(b.turno));
  const diasSem = ["Dom","Lun","Mar","Mié","Jue","Vie","Sáb"];
  let p = 0, a = 0;
  sorted.forEach(r => { if (r.status === "P" || r.status === "T") p += 0.5; else if (r.status === "A") a += 0.5; });

  el.innerHTML = `
    <div class="idh">
      <h3>${esc(s.full_name)}</h3>
      <div class="idt"><span class="status-P">P: ${p.toFixed(1)}</span><span class="status-A">A: ${a.toFixed(1)}</span></div>
    </div>
    <div class="informe-table-wrap">
      <table class="informe-table">
        <thead><tr><th>Fecha</th><th>Día</th><th>Turno</th><th>Estado</th></tr></thead>
        <tbody>${sorted.map(r => {
          const d = new Date(r.date + "T00:00:00");
          const cls = r.status === "P" ? "status-P" : r.status === "A" ? "status-A" : "status-T";
          return `<tr><td>${r.date}</td><td>${diasSem[d.getDay()]}</td><td>${TURNO_LABEL[r.turno] || r.turno}</td><td class="${cls}">${r.status}</td></tr>`;
        }).join("")}</tbody>
      </table>
    </div>`;
}

// ═══════════════════════════════════════════════════════════════
//  AJUSTES / MODO OSCURO
// ═══════════════════════════════════════════════════════════════

function renderAjustes() {
  const el = document.getElementById("ajustesContent");
  if (!el) return;
  const isDark = document.documentElement.classList.contains("dark");
  el.innerHTML = `
    <div class="ajustes-card">
      <h3>🎨 Apariencia</h3>
      <div class="ajustes-row">
        <div>
          <div class="ajustes-row-label">Modo oscuro</div>
          <div class="ajustes-row-desc">Cambia entre tema claro y oscuro</div>
        </div>
        <label class="toggle-switch">
          <input type="checkbox" ${isDark ? 'checked' : ''} onchange="toggleDarkMode(this.checked)">
          <span class="toggle-slider"></span>
        </label>
      </div>
    </div>
    <div class="ajustes-card">
      <h3>ℹ️ Información</h3>
      <div class="ajustes-row">
        <div>
          <div class="ajustes-row-label">Versión</div>
          <div class="ajustes-row-desc">App Asistencia E.E.S.T. N°5</div>
        </div>
        <div style="font-size:13px;color:var(--muted-foreground)">1.0</div>
      </div>
      <div class="ajustes-row">
        <div>
          <div class="ajustes-row-label">Firebase</div>
          <div class="ajustes-row-desc">Datos almacenados en la nube</div>
        </div>
        <div style="font-size:12px;color:var(--success);font-weight:600">Conectado</div>
      </div>
    </div>
  `;
}

function toggleDarkMode(enable) {
  if (enable) {
    document.documentElement.classList.add("dark");
  } else {
    document.documentElement.classList.remove("dark");
  }
  localStorage.setItem("asistencia_dark", enable ? "1" : "0");
}

function loadDarkMode() {
  if (localStorage.getItem("asistencia_dark") === "1") {
    document.documentElement.classList.add("dark");
  }
}

// ═══════════════════════════════════════════════════════════════
//  INIT
// ═══════════════════════════════════════════════════════════════

function hideSplash() {
  const el = document.getElementById("splash");
  if (el) { el.style.opacity = "0"; setTimeout(() => el.remove(), 500); }
}

authFB.onAuthStateChanged(async (user) => {
  loadDarkMode();
  const msgs = document.getElementById("splashMsg");
  if (msgs) msgs.textContent = "Cargando...";

  if (user) {
    try {
      const userDoc = await fdb.collection("users").doc(user.uid).get();
      const displayName = userDoc.exists
        ? (userDoc.data().full_name || user.displayName || user.email?.split("@")[0] || "Usuario")
        : (user.displayName || user.email?.split("@")[0] || "Usuario");
      updateUserNames(displayName);
      hideSplash();
      navigate("dashboard");
    } catch (err) {
      console.error(err);
      hideSplash();
      showPage("auth");
    }
  } else {
    updateUserNames("");
    hideSplash();
    showPage("auth");
  }
});
