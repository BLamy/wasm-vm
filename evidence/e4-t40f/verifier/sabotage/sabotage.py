import sys
name=sys.argv[1]
D='crates/core/src/dispatch.rs'; L='crates/core/src/lib.rs'
subs={
 'S1-flush_page-no-retire':(D,"                if let Some(block) = self.slots[index].block.take() {\n                    block.live.set(false);\n                }","                if let Some(_block) = self.slots[index].block.take() {\n                }"),
 'S2-evict-no-retire':(D,"        if let Some(old) = &evicted {\n            old.live.set(false);\n        }",""),
 'S3-no-generation-check':(D,"block.live.get() && block.block_gen == generation && block.phys_start == phys","block.live.get() && generation == generation && block.phys_start == phys"),
 'S4-discovery-ungated':(L,"        let discover = self.block_discovery;","        let discover = true;"),
 'S5-no-phys-check':(D,"        if *at != phys {\n            return None;\n        }\n        let block = weak.upgrade()?;\n        (block.live.get() && block.block_gen == generation && block.phys_start == phys)","        let _ = at;\n        let block = weak.upgrade()?;\n        (block.live.get() && block.block_gen == generation)"),
 'S6-retire_all-empty':(D,"            if let Some(block) = &slot.block {\n                block.live.set(false);\n            }","            let _ = slot;"),
 'S7-no-live-check':(D,"block.live.get() && block.block_gen == generation && block.phys_start == phys","block.block_gen == generation && block.phys_start == phys"),
}
f,a,b=subs[name]
s=open(f).read(); assert s.count(a)==1,(name,s.count(a)); open(f,'w').write(s.replace(a,b))
