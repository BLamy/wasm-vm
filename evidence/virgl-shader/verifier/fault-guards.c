/* Verifier fault injection only: include the unmodified boundary to exercise
 * defensive failure cleanup. These synthetic failures do not claim upstream
 * compiler behavior or expand the supported shader profile. */
#define calloc verifier_calloc
#define vrend_convert_shader verifier_convert_shader
#include "../../../renderer/virgl-shader/bridge.c"
#undef calloc
#undef vrend_convert_shader
extern void *calloc(size_t, size_t);
extern bool vrend_convert_shader(const struct vrend_context *, const struct vrend_shader_cfg *, const struct tgsi_token *, uint32_t, const struct vrend_shader_key *, struct vrend_shader_info *, struct vrend_variable_shader_info *, struct vrend_strarray *);
static int inject;
void *verifier_calloc(size_t n, size_t size) { if (inject == 1) { inject = 0; return NULL; } return calloc(n, size); }
bool verifier_convert_shader(const struct vrend_context *r, const struct vrend_shader_cfg *c, const struct tgsi_token *t, uint32_t mem, const struct vrend_shader_key *k, struct vrend_shader_info *i, struct vrend_variable_shader_info *v, struct vrend_strarray *s)
{
   bool ok = vrend_convert_shader(r,c,t,mem,k,i,v,s);
   if (!ok) return false;
   if (inject == 2) return false;
   if (inject == 3) os_log_message("synthetic verifier diagnostic");
   if (inject == 4 || inject == 5) {
      size_t length = inject == 4 ? BRIDGE_MAX_GLSL + 1 : 30000;
      free(s->strings[0].buf);
      s->strings[0].buf = malloc(length + 1);
      if (!s->strings[0].buf) abort();
      memset(s->strings[0].buf, inject == 4 ? 'A' : '\n', length);
      s->strings[0].buf[length] = 0;
   }
   return true;
}
static void diagnostic(const char *fmt, ...) { va_list a;va_start(a,fmt);virgl_logv(0,fmt,a);va_end(a); }
int main(void)
{
   const char valid[]="VERT\nDCL IN[0]\nDCL OUT[0], POSITION\nMOV OUT[0], IN[0]\nEND\n";
   char *baseline=strdup(bridge_translate(0,valid,sizeof(valid)-1));
   if (!baseline || !strstr(baseline,"\"ok\":true")) abort();
   for (int mode=1;mode<=5;++mode) {
      inject=mode;
      const char *result=bridge_translate(0,valid,sizeof(valid)-1);
      if (!strstr(result,"\"ok\":false") || !strstr(result,"\"code\":\"translation-error\"")) abort();
      printf("injected_failure=%d result=%s\n",mode,result);
      inject=0;
      if (strcmp(baseline,bridge_translate(0,valid,sizeof(valid)-1))) abort();
   }
   upstream_logged=false;diagnostic("%s","synthetic verifier diagnostic");if(!upstream_logged)abort();
   vrend_print_context_name(NULL);
   free(baseline);
   puts("PASS five defensive fault paths returned bounded errors and recovered byte-identically; diagnostic shims executed");
   return 0;
}
