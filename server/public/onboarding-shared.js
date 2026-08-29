(function () {
  var token = location.pathname.split('/')[2];
  var app = document.getElementById('app');
  var ctx = null;         // server context
  var ticker = null;
  var files = {};         // { key: {name,base64} }  or  { key: [ ... ] } for multi
  var prevCompanies = []; // [{ id }]
  var QUERIES = [];
  function timeAgo(iso){ try{ var d=new Date(iso); var diff=(Date.now()-d.getTime())/1000; if(diff<60)return 'just now'; if(diff<3600)return Math.floor(diff/60)+'m ago'; if(diff<86400)return Math.floor(diff/3600)+'h ago'; return Math.floor(diff/86400)+'d ago'; }catch(e){ return ''; } }
  function queryModalHtml(){
    return '<div class="qoverlay hidden" id="qoverlay">'
      + '<div class="qmodal">'
      +   '<div class="qmh"><div><div class="qmt">Ask your HR a question</div><div class="qms">Anything about your joining, documents, or first day</div></div>'
      +     '<button type="button" class="qmx" id="qmClose">&times;</button></div>'
      +   '<div class="qmb">'
      +     '<label class="qmlabel">Your question</label>'
      +     '<textarea id="qinput" class="qinput" placeholder="Type your question here\u2026"></textarea>'
      +     '<button type="button" class="qsend" id="qsend">Send question</button>'
      +     '<div class="qerr hidden" id="qerr"></div>'
      +     '<div class="qthread" id="qthreadWrap"><div class="qtlabel">Your previous questions</div><div id="qlist"></div></div>'
      +   '</div>'
      + '</div></div>';
  }
  function renderQueries(list){
    QUERIES = list || [];
    var box = document.getElementById('qlist');
    var badge = document.getElementById('askN');
    var threadWrap = document.getElementById('qthreadWrap');
    if (badge){ if (QUERIES.length){ badge.textContent = QUERIES.length; badge.className = 'askn'; } else { badge.className = 'askn hidden'; } }
    if (threadWrap){ threadWrap.className = QUERIES.length ? 'qthread' : 'qthread hidden'; }
    if (!box) return;
    if (!QUERIES.length){ box.innerHTML=''; return; }
    box.innerHTML = QUERIES.slice().reverse().map(function(q){
      var reply = q.reply ? ('<div class="qir"><div class="qirl">HR replied</div>'+esc(q.reply)+'</div>') : '<div class="qip">Awaiting HR response\u2026</div>';
      return '<div class="qi"><div class="qim">'+esc(q.message)+'</div><div class="qit">Asked '+timeAgo(q.at)+'</div>'+reply+'</div>';
    }).join('');
  }
  var saveTimer = null;

  function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];}); }
  function el(id){ return document.getElementById(id); }
  function val(id){ var e=el(id); return e?e.value.trim():''; }
  function pad(n){ return (n<10?'0':'')+n; }
  function fmtDate(d){ try { return new Date(d+'T00:00:00').toLocaleDateString([], {weekday:'long', month:'long', day:'numeric', year:'numeric'}); } catch(e){ return d; } }

  function fileToB64(file, cb){
    var r = new FileReader();
    r.onload = function(){ cb({ name: file.name, base64: String(r.result).split(',')[1] }); };
    r.readAsDataURL(file);
  }

  fetch('/api/careers/onboarding/' + encodeURIComponent(token))
    .then(function(r){ return r.json().then(function(d){ return {ok:r.ok, d:d}; }); })
    .then(function(res){
      if (!res.ok){ renderError(res.d && res.d.error); return; }
      if (res.d.expired){ renderExpired(res.d.candidateName); return; }
      if (res.d.submitted){ renderDone(res.d.candidateName, true); return; }
      ctx = res.d;
      render();
    })
    .catch(function(){ renderError('Something went wrong. Please try again.'); });

  function renderExpired(name){
    app.innerHTML = '<div class="band"><div class="band-inner"><div class="brand">Qtonix<span>.</span></div>'
      + '<h1>Onboarding link expired</h1></div></div>'
      + '<div class="wrap"><div class="card"><div class="ok"><div class="big">&#9203;</div>'
      + '<h2>This onboarding link has expired</h2>'
      + '<p class="muted">Onboarding links close the day before your joining date. If you still need to submit your details, '
      + 'please contact your HR contact and they can reactivate the link for you.</p></div></div></div>';
  }

  function renderError(msg){
    app.innerHTML = '<div class="band"><div class="band-inner"><div class="brand">Qtonix<span>.</span></div>'
      + '<h1>Onboarding link</h1></div></div>'
      + '<div class="wrap"><div class="card"><div class="ok"><div class="big">&#128533;</div><h2>'
      + esc(msg||'This link is not valid.') + '</h2><p class="muted">Please contact your HR contact for help.</p></div></div></div>';
  }
  function renderDone(name, already){
    app.innerHTML = '<div class="band"><div class="band-inner"><div class="brand">Qtonix<span>.</span></div>'
      + '<h1>Thank you'+(name?', '+esc(String(name).split(' ')[0]):'')+'!</h1></div></div>'
      + '<div class="wrap"><div class="card"><div class="ok"><div class="big">&#127881;</div>'
      + '<h2>'+(already?'You have already submitted your details':'Your details have been submitted')+'</h2>'
      + '<p class="muted">Our HR team will review everything and get back to you before your joining day. '
      + 'Please remember to carry your <strong>original documents</strong> for verification on day one.</p></div></div></div>';
  }

  var BLOOD = ['A+','A-','B+','B-','O+','O-','AB+','AB-'];
  var QUALS = ['10th','+2','Graduation','Post Graduation','Master','Other'];
  var PROOFS = ['Passport','Voter ID','Driving License'];

  function fieldHtml(o){
    // o: { id, label, type, req, opts, ph, half }
    var input;
    if (o.type === 'select'){
      input = '<select id="'+o.id+'"><option value="">'+(o.ph||'Select')+'</option>'
        + (o.opts||[]).map(function(v){ return '<option value="'+esc(v)+'">'+esc(v)+'</option>'; }).join('') + '</select>';
    } else {
      input = '<input id="'+o.id+'" type="'+(o.type||'text')+'" placeholder="'+esc(o.ph||'')+'"'+(o.value?' value="'+esc(o.value)+'"':'')+' />';
    }
    return '<div class="f">'
      + '<label>'+esc(o.label)+(o.req?' <span class="req">*</span>':'')+'</label>'
      + input
      + '<div class="ferr" id="err_'+o.id+'"></div></div>';
  }
  function upHtml(key, label){
    return '<div class="up" id="up_'+key+'" data-key="'+key+'"><div class="ic">&#128206;</div><span id="uplbl_'+key+'">'+esc(label)+'</span></div>';
  }

  function render(){
    var c = ctx;
    var first = (c.candidateName||'').split(' ')[0] || 'there';
    var deadlineTxt = c.joiningDate ? ('Please submit before your joining day &middot; ' + fmtDate(c.joiningDate)) : 'Please complete your details below';
    var hr = c.hr;
    var pf = c.prefill || {};

    var html = ''
    + '<div class="band"><div class="band-inner">'
    +   '<div class="brandrow"><div class="brand">Qtonix<span>.</span></div>'
    +     '<button type="button" class="askbtn" id="askBtn">'
    +       '<span class="qico">&#128172;</span> Ask a question'
    +       '<span class="askn hidden" id="askN">0</span>'
    +     '</button>'
    +   '</div>'
    +   '<div class="kicker">Welcome Aboard</div>'
    +   '<h1>Let\'s get you ready, '+esc(first)+'</h1>'
    +   '<div class="sub">'+esc(c.role||'')+(c.joiningDate?(' &middot; Joining '+fmtDate(c.joiningDate)):'')+(c.branch?(' &middot; '+esc(c.branch)):'')+'</div>'
    + '</div></div>'
    + '<div class="wrap"><div class="card">'
    +   '<div class="timer" id="timer"><div><div class="lab">Time to your joining day</div><div class="deadline">'+deadlineTxt+'</div></div>'
    +     '<div class="clock" id="clock"></div></div>'
    +   '<div class="pad">'
    +     (hr ? ('<div class="hrbox"><div class="hrav">'+(hr.avatar?('<img src="'+esc(hr.avatar)+'">'):esc((hr.name||'?').slice(0,1)))+'</div>'
    +       '<div><div class="k">Your HR contact</div><div class="v">'+esc(hr.name)+'</div></div>'
    +       (hr.phone?('<div class="contact"><div class="k">Questions? Call / WhatsApp</div><a href="tel:'+esc(hr.phone.replace(/\s+/g,''))+'">'+esc(hr.phone)+'</a></div>'):'')
    +       '</div>') : '')
    +     '<div class="prog"><div class="progbar"><span id="progfill"></span></div><div class="progtxt" id="progtxt">0% complete</div></div>'
    // Section 1
    +     '<div class="stitle"><span class="n">1</span>Your details</div>'
    +     '<div class="photo"><div class="ph" id="photoBox" data-key="photo">&#128247;</div><div><div style="font-size:13px;font-weight:700">Profile photo <span class="req">*</span></div><div class="muted">Tap to upload a clear passport-style photo</div></div></div>'
    +     '<div class="grid2">'
    +       fieldHtml({id:'name',label:'Full name',req:true,value:pf.name})
    +       fieldHtml({id:'email',label:'Email',type:'email',req:true,value:pf.email})
    +       fieldHtml({id:'phone',label:'Phone',req:true,value:pf.phone,ph:'+91 98765 43210'})
    +       fieldHtml({id:'fatherName',label:"Father's name",req:true})
    +       fieldHtml({id:'dob',label:'Date of birth',type:'date',req:true})
    +       fieldHtml({id:'bloodGroup',label:'Blood group',type:'select',req:true,opts:BLOOD})
    +       fieldHtml({id:'maritalStatus',label:'Marital status',type:'select',req:true,opts:['Unmarried','Married']})
    +       '<div id="anniversaryWrap" class="hidden">' + fieldHtml({id:'anniversary',label:'Anniversary date',type:'date',req:false}) + '</div>'
    +     '</div>'
    // Section 2
    +     '<div class="stitle"><span class="n">2</span>Address</div>'
    +     '<div class="grid2">'
    +       fieldHtml({id:'presentAddress',label:'Present address',req:true,ph:'House, street, city, PIN'})
    +       fieldHtml({id:'permanentAddress',label:'Permanent address',req:true,ph:'House, street, city, PIN'})
    +     '</div>'
    +     '<label class="chk"><input type="checkbox" id="sameAddr"> Permanent address same as present</label>'
    // Section 3
    +     '<div class="stitle"><span class="n">3</span>Identity documents</div>'
    +     '<div class="grid2">'
    +       fieldHtml({id:'pan',label:'PAN number',req:true,ph:'ABCDE1234F'})
    +       '<div style="align-self:end">'+upHtml('panCard','Upload PAN card')+'</div>'
    +       fieldHtml({id:'aadhaar',label:'Aadhaar number',req:true,ph:'1234 5678 9012'})
    +       '<div style="align-self:end">'+upHtml('aadhaarCard','Upload Aadhaar card')+'</div>'
    +       fieldHtml({id:'addressProofType',label:'Address proof type',type:'select',req:true,opts:PROOFS})
    +       '<div style="align-self:end">'+upHtml('addressProof','Upload document')+'</div>'
    +     '</div>'
    // Section 4
    +     '<div class="stitle"><span class="n">4</span>Education &mdash; highest qualification</div>'
    +     '<div class="grid2">'
    +       fieldHtml({id:'qualification',label:'Qualification',type:'select',req:true,opts:QUALS})
    +       '<div id="qualOtherWrap" class="hidden">'+fieldHtml({id:'qualificationOther',label:'Specify qualification',req:true})+'</div>'
    +     '</div>'
    +     '<div class="updual" style="margin-top:12px">'+upHtml('degreeCertificate','Degree certificate')+upHtml('marksheets','Marksheets (can add multiple)')+'</div>'
    // Section 5 (experience)
    +     (c.experienced ? ('<div class="stitle"><span class="n">5</span>Work experience</div><div id="companies"></div><button type="button" class="addbtn" id="addCompany">+ Add previous company</button>') : '')
    +     '<button class="btn" id="submitBtn">Submit my details &amp; documents</button>'
    +     '<div class="err hidden" id="formErr"></div>'
    +     '<div class="savenote">&#10003; Your progress is saved automatically &mdash; you can finish later from the same link</div>'
    +   '</div>'
    + '</div></div>'
    + queryModalHtml();

    app.innerHTML = html;
    wire();
    if (c.experienced){ addCompany(); }
    restoreDraft();
    startClock();
    recomputeProgress();
  }

  function wire(){
    // marital -> anniversary required
    el('maritalStatus').addEventListener('change', function(){
      var ann = el('anniversary');
      var wrap = el('anniversaryWrap');
      if (this.value === 'Married'){ wrap.className=''; ann.disabled = false; } else { wrap.className='hidden'; ann.disabled = true; ann.value = ''; }
      recomputeProgress();
    });
    el('anniversary').disabled = true;
    // qualification other
    el('qualification').addEventListener('change', function(){
      el('qualOtherWrap').className = (this.value === 'Other') ? '' : 'hidden';
      recomputeProgress();
    });
    // same address
    el('sameAddr').addEventListener('change', function(){
      var perm = el('permanentAddress');
      if (this.checked){ perm.value = el('presentAddress').value; perm.disabled = true; } else { perm.disabled = false; }
      recomputeProgress(); scheduleSave();
    });
    el('presentAddress').addEventListener('input', function(){
      if (el('sameAddr').checked) el('permanentAddress').value = this.value;
    });
    // uploads (single + photo)
    Array.prototype.forEach.call(document.querySelectorAll('.up'), function(u){ u.addEventListener('click', function(){ pickFile(u.getAttribute('data-key')); }); });
    el('photoBox').addEventListener('click', function(){ pickFile('photo'); });
    // any input change -> progress + autosave
    Array.prototype.forEach.call(document.querySelectorAll('input,select'), function(i){
      i.addEventListener('input', function(){ recomputeProgress(); scheduleSave(); });
      i.addEventListener('blur', function(){ validateField(i.id); });
    });
    if (el('addCompany')) el('addCompany').addEventListener('click', addCompany);
    el('submitBtn').addEventListener('click', submit);
    // Ask-a-question wiring.
    renderQueries((ctx && ctx.queries) || []);
    var askBtn = el('askBtn'); var qov = el('qoverlay'); var qmClose = el('qmClose');
    function openQ(){ if(qov){ qov.className='qoverlay'; var qi=el('qinput'); if(qi) setTimeout(function(){qi.focus();},50); } }
    function closeQ(){ if(qov){ qov.className='qoverlay hidden'; } }
    if (askBtn) askBtn.addEventListener('click', openQ);
    if (qmClose) qmClose.addEventListener('click', closeQ);
    if (qov) qov.addEventListener('click', function(e){ if(e.target===qov) closeQ(); });
    var qsend = el('qsend');
    if (qsend) qsend.addEventListener('click', function(){
      var input = el('qinput'); var msg = (input.value||'').trim();
      var qe = el('qerr');
      if (!msg){ qe.textContent='Please type your question.'; qe.className='qerr'; return; }
      qsend.disabled = true; qsend.textContent = 'Sending\u2026'; qe.className='qerr hidden';
      fetch('/api/careers/onboarding/' + encodeURIComponent(token) + '/query', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ message: msg }) })
        .then(function(r){ return r.json(); })
        .then(function(res){
          qsend.disabled=false; qsend.textContent='Send question';
          if (res && res.query){ input.value=''; QUERIES.push(res.query); renderQueries(QUERIES); }
          else { qe.textContent=(res && res.error)||'Could not send.'; qe.className='qerr'; }
        })
        .catch(function(){ qsend.disabled=false; qsend.textContent='Send question'; qe.textContent='Network error. Please try again.'; qe.className='qerr'; });
    });
  }

  function pickFile(key){
    var multi = (key === 'marksheets');
    var inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'image/*,application/pdf'; if (multi) inp.multiple = true;
    inp.onchange = function(){
      var list = Array.prototype.slice.call(inp.files);
      if (!list.length) return;
      var tooBig = list.filter(function(f){ return f.size > 5*1024*1024; });
      if (tooBig.length){ alert('Each file must be 5 MB or smaller.'); return; }
      if (multi){
        files[key] = files[key] || [];
        var pending = list.length;
        list.forEach(function(f){ fileToB64(f, function(o){ files[key].push(o); if(--pending===0){ markUpload(key); recomputeProgress(); } }); });
      } else {
        fileToB64(list[0], function(o){ files[key] = o; markUpload(key, list[0]); recomputeProgress(); });
      }
    };
    inp.click();
  }
  function markUpload(key, file){
    if (key === 'photo'){
      var b = el('photoBox');
      if (files.photo && files.photo.base64){ b.innerHTML = '<img src="data:image/*;base64,'+files.photo.base64+'">'; }
      return;
    }
    var box = el('up_'+key), lbl = el('uplbl_'+key);
    if (!box) return;
    if (key === 'marksheets'){ box.className = 'up filled'; lbl.textContent = (files.marksheets||[]).length + ' file(s) added'; }
    else { box.className = 'up filled'; lbl.textContent = (file && file.name ? file.name : 'Uploaded') + '  \u2713'; }
  }

  // ---- companies ----
  function addCompany(){
    var id = 'co' + (prevCompanies.length);
    prevCompanies.push({ id: id });
    var wrap = document.createElement('div');
    wrap.className = 'addblock'; wrap.id = id;
    wrap.innerHTML = (prevCompanies.length>1 ? '<button type="button" class="rm" data-id="'+id+'">&times;</button>' : '')
      + '<div class="f" style="margin-bottom:10px"><label>Company name <span class="req">*</span></label><input id="'+id+'_name" placeholder="Company name" /><div class="ferr" id="err_'+id+'_name"></div></div>'
      + '<div class="updual">'+upHtml(id+'_exp','Experience / relieving letter')+upHtml(id+'_slips','Last 3 months salary slips')+'</div>';
    el('companies').appendChild(wrap);
    wrap.querySelectorAll('.up').forEach(function(u){ u.addEventListener('click', function(){ pickCompanyFile(u.getAttribute('data-key')); }); });
    var nm = el(id+'_name'); nm.addEventListener('input', function(){ recomputeProgress(); scheduleSave(); });
    var rm = wrap.querySelector('.rm'); if (rm) rm.addEventListener('click', function(){ removeCompany(id); });
    recomputeProgress();
  }
  function removeCompany(id){
    prevCompanies = prevCompanies.filter(function(c){ return c.id !== id; });
    delete files[id+'_exp']; delete files[id+'_slips'];
    var n = el(id); if (n) n.remove();
    recomputeProgress();
  }
  function pickCompanyFile(key){
    var inp = document.createElement('input');
    inp.type='file'; inp.accept='image/*,application/pdf'; inp.multiple = true;
    inp.onchange = function(){
      var list = Array.prototype.slice.call(inp.files); if(!list.length) return;
      if (list.some(function(f){return f.size>5*1024*1024;})){ alert('Each file must be 5 MB or smaller.'); return; }
      files[key] = files[key] || [];
      var pending = list.length;
      list.forEach(function(f){
        fileToB64(f, function(o){
          files[key].push(o);
          if (--pending === 0){
            var box = el('up_'+key), lbl = el('uplbl_'+key);
            if (box){ box.className='up filled'; lbl.textContent = (files[key]||[]).length + ' file(s) added'; }
            recomputeProgress();
          }
        });
      });
    };
    inp.click();
  }

  // ---- validation ----
  var PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
  function age(dob){ try { var d=new Date(dob); var t=new Date(); var a=t.getFullYear()-d.getFullYear(); var m=t.getMonth()-d.getMonth(); if(m<0||(m===0&&t.getDate()<d.getDate()))a--; return a; } catch(e){ return 0; } }
  function setErr(id, msg){
    var e = el('err_'+id), f = el(id);
    if (!e) return !msg;
    if (msg){ e.textContent = msg; e.className='ferr show'; if(f) f.className = (f.tagName==='SELECT'?'':'')+' bad'; return false; }
    e.className='ferr'; if(f) f.className=''; return true;
  }
  function validateField(id){
    var v = val(id);
    switch(id){
      case 'name': return setErr(id, v?'':'Required');
      case 'email': return setErr(id, /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)?'':'Enter a valid email');
      case 'phone': return setErr(id, (v.replace(/\D/g,'').length>=10)?'':'Enter a valid phone number');
      case 'fatherName': return setErr(id, v?'':'Required');
      case 'dob': return setErr(id, !v?'Required':(age(v)<18?'Must be at least 18':''));
      case 'bloodGroup': return setErr(id, v?'':'Select blood group');
      case 'maritalStatus': return setErr(id, v?'':'Select one');
      case 'anniversary': return setErr(id, (el('maritalStatus').value==='Married' && !v)?'Required for married':'');
      case 'presentAddress': return setErr(id, v.length>=10?'':'Enter full address');
      case 'permanentAddress': return setErr(id, (el('sameAddr').checked||v.length>=10)?'':'Enter full address');
      case 'pan': return setErr(id, PAN_RE.test(v.toUpperCase())?'':'Format: ABCDE1234F');
      case 'aadhaar': return setErr(id, (v.replace(/\D/g,'').length===12)?'':'Enter 12-digit Aadhaar');
      case 'addressProofType': return setErr(id, v?'':'Select a document');
      case 'qualification': return setErr(id, v?'':'Select qualification');
      case 'qualificationOther': return setErr(id, (el('qualification').value==='Other' && !v)?'Required':'');
      default: return true;
    }
  }

  function requiredFileKeys(){
    var keys = ['panCard','aadhaarCard','addressProof','degreeCertificate','marksheets'];
    return keys;
  }
  function hasFile(k){ var f=files[k]; return Array.isArray(f)? f.length>0 : !!(f&&f.base64); }

  function recomputeProgress(){
    // count required fields + files satisfied
    var ids = ['name','email','phone','fatherName','dob','bloodGroup','maritalStatus','presentAddress','permanentAddress','pan','aadhaar','addressProofType','qualification'];
    if (el('maritalStatus').value==='Married') ids.push('anniversary');
    if (el('qualification').value==='Other') ids.push('qualificationOther');
    var total = ids.length + 1 /*photo*/ + requiredFileKeys().length;
    var done = 0;
    ids.forEach(function(id){ var v = val(id); if (id==='permanentAddress' && el('sameAddr').checked) { if(val('presentAddress').length>=10) done++; return;} if (v) done++; });
    if (hasFile('photo')) done++;
    requiredFileKeys().forEach(function(k){ if (hasFile(k)) done++; });
    // experience
    if (ctx.experienced && prevCompanies.length){
      prevCompanies.forEach(function(c){ total += 3; if(val(c.id+'_name')) done++; if(hasFile(c.id+'_exp')) done++; if(hasFile(c.id+'_slips')) done++; });
    }
    var pct = Math.min(100, Math.round(done/total*100));
    el('progfill').style.width = pct+'%';
    el('progtxt').textContent = pct+'% complete';
  }

  // ---- autosave draft (fields only) ----
  function collectFields(){
    return {
      name:val('name'), email:val('email'), phone:val('phone'), fatherName:val('fatherName'),
      dob:val('dob'), bloodGroup:val('bloodGroup'), maritalStatus:val('maritalStatus'), anniversary:val('anniversary'),
      presentAddress:val('presentAddress'), permanentAddress: el('sameAddr').checked?val('presentAddress'):val('permanentAddress'),
      sameAddr: el('sameAddr').checked, pan:val('pan').toUpperCase(), aadhaar:val('aadhaar'),
      addressProofType:val('addressProofType'), qualification:val('qualification'), qualificationOther:val('qualificationOther'),
      companies: prevCompanies.map(function(c){ return { name: val(c.id+'_name') }; })
    };
  }
  function scheduleSave(){ if(saveTimer) clearTimeout(saveTimer); saveTimer = setTimeout(saveDraft, 1200); }
  function saveDraft(){
    try { fetch('/api/careers/onboarding/'+encodeURIComponent(token)+'/draft', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ draft: collectFields() }) }); } catch(e){}
  }
  function restoreDraft(){
    var d = ctx.draft; if (!d) return;
    ['name','email','phone','fatherName','dob','bloodGroup','maritalStatus','anniversary','presentAddress','permanentAddress','pan','aadhaar','addressProofType','qualification','qualificationOther'].forEach(function(id){ if(el(id) && d[id]!=null && d[id]!=='') el(id).value = d[id]; });
    if (d.sameAddr){ el('sameAddr').checked = true; el('permanentAddress').disabled = true; }
    if (d.maritalStatus==='Married'){ el('anniversary').disabled = false; }
    if (d.qualification==='Other'){ el('qualOtherWrap').className=''; }
    recomputeProgress();
  }

  // ---- submit ----
  function submit(){
    var okAll = true;
    var reqIds = ['name','email','phone','fatherName','dob','bloodGroup','maritalStatus','presentAddress','permanentAddress','pan','aadhaar','addressProofType','qualification'];
    if (el('maritalStatus').value==='Married') reqIds.push('anniversary');
    if (el('qualification').value==='Other') reqIds.push('qualificationOther');
    reqIds.forEach(function(id){ if(!validateField(id)) okAll=false; });
    // files
    var missing = [];
    if (!hasFile('photo')) missing.push('profile photo');
    requiredFileKeys().forEach(function(k){ if(!hasFile(k)){ missing.push(k.replace(/([A-Z])/g,' $1').toLowerCase()); } });
    if (ctx.experienced){
      prevCompanies.forEach(function(c){
        if(!val(c.id+'_name')){ setErr(c.id+'_name','Required'); okAll=false; }
        if(!hasFile(c.id+'_exp')) missing.push('experience letter');
        if(!hasFile(c.id+'_slips')) missing.push('salary slips');
      });
    }
    var fe = el('formErr');
    if (!okAll || missing.length){
      fe.className='err'; fe.textContent = 'Please complete all required fields' + (missing.length?(' and uploads: '+missing.join(', ')):'') + '.';
      window.scrollTo({top:0,behavior:'smooth'});
      return;
    }
    fe.className='err hidden';
    var btn = el('submitBtn'); btn.disabled = true; btn.textContent = 'Uploading your documents...';

    var payload = {
      fields: collectFields(),
      files: { photo:files.photo||null, panCard:files.panCard||null, aadhaarCard:files.aadhaarCard||null, addressProof:files.addressProof||null, degreeCertificate:files.degreeCertificate||null, marksheets:files.marksheets||[] },
      prevCompanies: prevCompanies.map(function(c){ return { name: val(c.id+'_name'), expLetters: files[c.id+'_exp']||[], salarySlips: files[c.id+'_slips']||[] }; })
    };
    fetch('/api/careers/onboarding/'+encodeURIComponent(token)+'/submit', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) })
      .then(function(r){ return r.json().then(function(d){ return {ok:r.ok,d:d}; }); })
      .then(function(res){ if(!res.ok){ throw new Error((res.d&&res.d.error)||'Submission failed'); } renderDone(ctx.candidateName, false); })
      .catch(function(e){ btn.disabled=false; btn.textContent='Submit my details & documents'; fe.className='err'; fe.textContent = e.message; });
  }

  // ---- countdown ----
  function startClock(){
    if (!ctx.joiningDate) { el('clock').style.display='none'; return; }
    function tick(){
      var target = new Date(ctx.joiningDate + 'T' + (ctx.joiningTime||'09:30') + ':00').getTime();
      var diff = target - Date.now();
      if (diff < 0) diff = 0;
      var d = Math.floor(diff/86400000), h = Math.floor(diff%86400000/3600000), m = Math.floor(diff%3600000/60000);
      el('clock').innerHTML = seg(d,'Days')+seg(h,'Hrs')+seg(m,'Min');
    }
    function seg(n,u){ return '<div class="seg"><div class="num">'+pad(n)+'</div><div class="unit">'+u+'</div></div>'; }
    tick(); if(ticker) clearInterval(ticker); ticker = setInterval(tick, 30000);
  }
})();
