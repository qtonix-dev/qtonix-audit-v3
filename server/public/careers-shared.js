// Shared application-form renderer used by both the embed (form-only) and the
// full listing page. Exposes window.CareersShared.
(function () {
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function fieldOn(v) { return v === 'mandatory' || v === 'optional'; }
  function reqMark(v) { return v === 'mandatory' ? ' <span class="req">*</span>' : ''; }

  function fileToBase64(file) {
    return new Promise(function (res, rej) {
      var r = new FileReader();
      r.onload = function () { res(r.result); };
      r.onerror = rej;
      r.readAsDataURL(file);
    });
  }

  function renderForm(host, job, token) {
    var ff = job.formFields || {};
    var html = '<form id="applyForm">';
    html += '<div class="row"><div><label>First name <span class="req">*</span></label><input name="firstName" required></div>'
          + '<div><label>Last name <span class="req">*</span></label><input name="lastName" required></div></div>';
    html += '<label>Email <span class="req">*</span></label><input type="email" name="email" required>';
    html += '<label>Contact number</label><input type="tel" name="phone">';
    if (fieldOn(ff.currentLocation)) html += '<label>Current location' + reqMark(ff.currentLocation) + '</label><input name="currentLocation"' + (ff.currentLocation === 'mandatory' ? ' required' : '') + '>';

    // Resume — file upload (with a link fallback).
    html += '<label>Resume <span class="req">*</span></label>';
    html += '<div class="drop" id="resumeDrop">Drop file here or click to upload<div class="muted">PDF, Word or image · up to 5MB</div></div>';
    html += '<input type="file" id="resumeFile" accept=".pdf,.doc,.docx,.png,.jpg,.jpeg" style="display:none">';
    html += '<div id="resumeStatus" class="muted" style="margin-top:6px"></div>';
    html += '<input type="hidden" name="resumeUrl">';

    if (fieldOn(ff.photo)) {
      html += '<label>Photo' + reqMark(ff.photo) + '</label>';
      html += '<div class="drop" id="photoDrop">Drop image here or click to upload<div class="muted">Any image, up to 2MB</div></div>';
      html += '<input type="file" id="photoFile" accept="image/*" style="display:none"><div id="photoStatus" class="muted" style="margin-top:6px"></div><input type="hidden" name="photoUrl">';
    }
    if (fieldOn(ff.workExperience)) html += '<label>Work experience' + reqMark(ff.workExperience) + '</label><textarea name="workExperience" rows="2"' + (ff.workExperience === 'mandatory' ? ' required' : '') + '></textarea>';
    if (fieldOn(ff.educationDetails)) html += '<label>Education details' + reqMark(ff.educationDetails) + '</label><textarea name="educationDetails" rows="2"' + (ff.educationDetails === 'mandatory' ? ' required' : '') + '></textarea>';
    if (fieldOn(ff.noticePeriod)) html += '<label>Notice period' + reqMark(ff.noticePeriod) + '</label><input name="noticePeriod"' + (ff.noticePeriod === 'mandatory' ? ' required' : '') + '>';
    if (fieldOn(ff.ctc)) html += '<div class="row"><div><label>Current CTC' + reqMark(ff.ctc) + '</label><input name="currentCtc"' + (ff.ctc === 'mandatory' ? ' required' : '') + '></div><div><label>Expected CTC</label><input name="expectedCtc"></div></div>';
    if (fieldOn(ff.portfolio)) html += '<label>Work link / Portfolio' + reqMark(ff.portfolio) + '</label><input name="portfolio"' + (ff.portfolio === 'mandatory' ? ' required' : '') + '>';
    if (fieldOn(ff.gender)) html += '<label>Gender' + reqMark(ff.gender) + '</label><select name="gender"' + (ff.gender === 'mandatory' ? ' required' : '') + '><option value="">— Select —</option><option>Male</option><option>Female</option><option>Other</option><option>Prefer not to say</option></select>';

    (job.questions || []).forEach(function (q) {
      html += '<label>' + esc(q.question) + (q.mandatory ? ' <span class="req">*</span>' : '') + '</label>';
      var req = q.mandatory ? ' required' : '';
      if (q.type === 'multi') html += '<textarea data-q="' + q.id + '" rows="3"' + req + '></textarea>';
      else if (q.type === 'yesno') html += '<select data-q="' + q.id + '"' + req + '><option value="">— Select —</option><option>Yes</option><option>No</option></select>';
      else if (q.type === 'multiple') html += '<select data-q="' + q.id + '"' + req + '><option value="">— Select —</option>' + (q.options || []).map(function (o) { return '<option>' + esc(o) + '</option>'; }).join('') + '</select>';
      else if (q.type === 'file') html += '<input type="url" data-q="' + q.id + '" placeholder="Link to file"' + req + '>';
      else html += '<input data-q="' + q.id + '"' + req + '>';
    });

    html += '<div class="err" id="err"></div>';
    html += '<button class="btn" type="submit" id="submitBtn">Submit application</button></form>';
    host.innerHTML = html;

    wireUpload(host, token, 'resume');
    if (fieldOn(ff.photo)) wireUpload(host, token, 'photo');
    host.querySelector('#applyForm').addEventListener('submit', function (e) { submit(e, host, job, token); });
  }

  function wireUpload(host, token, kind) {
    var drop = host.querySelector('#' + kind + 'Drop');
    var file = host.querySelector('#' + kind + 'File');
    var status = host.querySelector('#' + kind + 'Status');
    var hidden = host.querySelector('[name="' + kind + 'Url"]');
    if (!drop) return;
    drop.addEventListener('click', function () { file.click(); });
    drop.addEventListener('dragover', function (e) { e.preventDefault(); drop.classList.add('on'); });
    drop.addEventListener('dragleave', function () { drop.classList.remove('on'); });
    drop.addEventListener('drop', function (e) { e.preventDefault(); drop.classList.remove('on'); if (e.dataTransfer.files[0]) doUpload(e.dataTransfer.files[0]); });
    file.addEventListener('change', function () { if (file.files[0]) doUpload(file.files[0]); });
    function doUpload(f) {
      if (f.size > 5 * 1024 * 1024) { status.textContent = 'File too large (max 5MB).'; return; }
      status.textContent = 'Uploading…';
      fileToBase64(f).then(function (b64) {
        return fetch('/api/careers/' + encodeURIComponent(token) + '/upload', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ base64: b64, fileName: f.name, kind: kind })
        });
      }).then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
        .then(function (res) {
          if (!res.ok) { status.textContent = res.d.error || 'Upload failed. You can paste a link below instead.'; return; }
          hidden.value = res.d.url; status.innerHTML = '✅ ' + esc(f.name) + ' uploaded';
        }).catch(function () { status.textContent = 'Upload failed. Try again.'; });
    }
  }

  function submit(e, host, job, token) {
    e.preventDefault();
    var f = e.target;
    var btn = host.querySelector('#submitBtn');
    var errEl = host.querySelector('#err');
    errEl.textContent = '';
    if (f.resumeUrl && !f.resumeUrl.value) { errEl.textContent = 'Please upload your resume.'; return; }
    var answers = {};
    f.querySelectorAll('[data-q]').forEach(function (el) { if (el.value) answers[el.getAttribute('data-q')] = el.value; });
    ['workExperience', 'educationDetails', 'noticePeriod', 'currentCtc', 'expectedCtc', 'portfolio', 'gender', 'photoUrl'].forEach(function (k) { if (f[k] && f[k].value) answers[k] = f[k].value; });
    var payload = {
      firstName: f.firstName.value, lastName: f.lastName.value, email: f.email.value,
      phone: f.phone ? f.phone.value : '', currentLocation: f.currentLocation ? f.currentLocation.value : '',
      resumeUrl: f.resumeUrl ? f.resumeUrl.value : '', answers: answers
    };
    btn.disabled = true; btn.textContent = 'Submitting…';
    fetch('/api/careers/' + encodeURIComponent(token) + '/apply', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (res) {
        if (!res.ok) { errEl.textContent = res.d.error || 'Something went wrong.'; btn.disabled = false; btn.textContent = 'Submit application'; return; }
        host.innerHTML = '<div class="ok"><div class="big">✅</div><h3>Application received</h3><p class="muted">Thanks for applying to ' + esc(job.title) + '. We\'ll be in touch.</p></div>';
      })
      .catch(function () { errEl.textContent = 'Network error. Please try again.'; btn.disabled = false; btn.textContent = 'Submit application'; });
  }

  window.CareersShared = { esc: esc, renderForm: renderForm };
})();
