/* Verifier-only translation unit: include the exact frozen bridge to reach
 * defensive checks against impossible pinned-upstream metadata. No runtime
 * bytes are edited; these cases do not claim guest reachability. */
#include "bridge.c"
#include <assert.h>
int main(void) {
 unsigned checks=0;
 #define VERIFY(x) do {assert(x);checks++;}while(0)
 struct conversion c={.profile={.stage=1}};
 c.profile.declared[IN][0]=true;c.profile.semantic_index[IN][0]=3;c.profile.flat[IN][0]=true;
 struct vrend_fs_shader_info *i=&c.variable.fs_info;
 i->num_interps=1;i->interpinfo[0]=(struct vrend_interp_info){.semantic_name=TGSI_SEMANTIC_GENERIC,.semantic_index=3,.location=TGSI_INTERPOLATE_LOC_CENTER,.interpolate=TGSI_INTERPOLATE_CONSTANT};
 VERIFY(checked_fragment_interface(&c));
 i->num_interps=0;VERIFY(!checked_fragment_interface(&c));i->num_interps=1;
 i->has_sample_input=true;VERIFY(!checked_fragment_interface(&c));i->has_sample_input=false;
 i->has_noperspective=true;VERIFY(!checked_fragment_interface(&c));i->has_noperspective=false;
 i->interpinfo[0].semantic_name=TGSI_SEMANTIC_COLOR;VERIFY(!checked_fragment_interface(&c));i->interpinfo[0].semantic_name=TGSI_SEMANTIC_GENERIC;
 i->interpinfo[0].semantic_index=8;VERIFY(!checked_fragment_interface(&c));i->interpinfo[0].semantic_index=3;
 i->interpinfo[0].location=TGSI_INTERPOLATE_LOC_CENTROID;VERIFY(!checked_fragment_interface(&c));i->interpinfo[0].location=TGSI_INTERPOLATE_LOC_CENTER;
 i->interpinfo[0].interpolate=TGSI_INTERPOLATE_PERSPECTIVE;VERIFY(!checked_fragment_interface(&c));i->interpinfo[0].interpolate=TGSI_INTERPOLATE_CONSTANT;
 i->interpinfo[0].semantic_index=4;VERIFY(!checked_fragment_interface(&c));i->interpinfo[0].semantic_index=3;
 c.profile.declared[IN][1]=true;c.profile.semantic_index[IN][1]=4;i->num_interps=2;i->interpinfo[1]=i->interpinfo[0];VERIFY(!checked_fragment_interface(&c));
 for(int stage=-1;stage<5;stage++)if(stage!=0&&stage!=1)VERIFY(strstr(bridge_translate(stage,"",0),"unsupported-stage"));
 begin_response(false);response_capacity=2;append("too long");VERIFY(response_overflow);
 begin_response(true);VERIFY(response_capacity==BRIDGE_MAX_PAIR_RESULT&&!response_overflow);begin_response(false);VERIFY(response_capacity==BRIDGE_MAX_RESULT&&!response_overflow);
 /* JSON escaping is a formatter defense; ordinary pinned GLSL has no quotes. */
 struct conversion formatter={0};VERIFY(strarray_alloc(&formatter.shader,SHADER_MAX_STRINGS));
 strbuf_append(&formatter.shader.strings[0],"\"\\\n");formatter.shader.num_strings=1;stage_result(&formatter);VERIFY(strstr(response,"\\\"")&&strstr(response,"\\\\")&&strstr(response,"\\u000a"));cleanup(&formatter);
 printf("{\"status\":\"passed\",\"trustedDefensiveChecks\":%u}\n",checks);
}
