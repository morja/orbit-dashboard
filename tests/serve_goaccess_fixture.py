import sys
import runpy
from pathlib import Path
root=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(root))
import server
original=server.Dashboard.__init__
def initialize(self, store, config, settings=None):
    config['goaccess']={'enabled':True,'host':'fixture','command':'/fixture/export'}
    original(self,store,config,settings)
server.Dashboard.__init__=initialize
server.GoAccessCache.read=lambda self: {'source':'fixture:/fixture/export','downloadedAt':'2026-10-11T14:00:00Z','reports':[{'id':'demo','label':'Example website <script>','hostname':'example.test','file':'fixture.html','generatedAt':'2026-10-11T02:15:00Z','status':'ready','summary':{'requests':1200,'visitors':37,'bandwidth':8000},'periods':{key:{'summary':{'requests':hits,'visitors':people,'bandwidth':8000},'startDate':'2026-10-01','endDate':'2026-10-11','dataStart':'2026-10-01','dataEnd':'2026-10-11','file':'fixture.html'} for key,hits,people in [('7',120,9),('30',1200,37),('all',3000,80)]}}]}
server.GoAccessCache.report=lambda self,identifier,period='all': b'''<!doctype html><html><body><h1>Synthetic GoAccess report</h1><script>window.reportWorks=(new Function("return 1")())===1;try { parent.document.body.dataset.compromised='yes'; } catch(error) { window.isolated=true; }</script></body></html>'''
runpy.run_path(str(root/'tests/serve_dashboard_fixture.py'),run_name='__main__')
