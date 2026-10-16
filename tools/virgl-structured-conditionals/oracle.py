"""Independent recursive evaluator of the authored literal TGSI proof subset."""
import re
import struct
from fractions import Fraction


def require(value,message):
    if not value:raise ValueError(message)


def float_word(value):return struct.unpack('<I',struct.pack('<f',value))[0]
def rational(word):
    sign,exponent,mantissa=word>>31,(word>>23)&255,word&0x7fffff
    require(exponent!=255,'finite exact numeric input')
    significand=mantissa if exponent==0 else (1<<23)+mantissa
    power=-149 if exponent==0 else exponent-150
    magnitude=Fraction(significand)*(Fraction(2**power) if power>=0 else Fraction(1,2**-power))
    return -magnitude if sign else magnitude


def exact_word(value):
    value=Fraction(value)
    if value==0:return 0
    sign=0x80000000 if value<0 else 0;value=abs(value)
    exponent=value.numerator.bit_length()-value.denominator.bit_length()
    power=lambda e:Fraction(2**e) if e>=0 else Fraction(1,2**-e)
    if value<power(exponent):exponent-=1
    scaled=value/power(exponent-23)
    require(-126<=exponent<=127 and scaled.denominator==1 and 2**23<=scaled<2**24,'only exact normal dyadic numeric fixtures')
    return sign+((exponent+127)<<23)+int(scaled)-2**23


def bank(vector):
    words=[0]*184;words[:4]=vector['c0'];words[176:180]=vector['condition'];words[180:184]=vector['c45'];return words


def interpret(text,inputs,words):
    state={('IN',int(i)):list(v) for i,v in inputs.items()}
    state.update({('CONST',i//4):words[i:i+4] for i in range(0,len(words),4)})
    instructions=[];branches=[]
    for line_no,original in enumerate(text.splitlines(),1):
        line=re.sub(r'^\d+:\s*','',original.strip())
        if re.match(r'^(VERT|FRAG|DCL)\b',line):continue
        if line.startswith('IMM'):
            m=re.fullmatch(r'IMM\[(\d+)\] (UINT32|FLT32) \{([^}]+)\}',line);require(m,'literal immediate syntax')
            values=[int(x) if m[2]=='UINT32' else float_word(float(x)) for x in m[3].split(',')]
            require(len(values)==4,'literal immediate vector');state[('IMM',int(m[1]))]=values;continue
        opcode,_,args=line.partition(' ');args=re.sub(r'\s*:\d+$','',args)
        instructions.append((line_no,opcode,[s.strip() for s in args.split(',')] if args else []))
    def source(s,lane):
        match=re.fullmatch(r'(IN|OUT|TEMP|CONST|IMM)\[(\d+)\](?:\.([xyzw]{1,4}))?',s);require(match,'restricted operand '+s)
        swizzle=match[3] or 'xyzw';index='xyzw'.index(swizzle[0 if len(swizzle)==1 else lane]);value=state.get((match[1],int(match[2])),[None]*4)[index]
        require(type(value) is int and 0<=value<2**32,'defined selected lane '+s);return value
    def execute(begin,end):
        at=begin
        while at<end:
            line,opcode,args=instructions[at]
            if opcode=='UIF':
                depth=1;middle=None;last=at+1
                while depth:
                    require(last<end,'closed recursive structure');other=instructions[last][1]
                    if other=='UIF':depth+=1
                    elif other=='ENDIF':depth-=1
                    elif other=='ELSE' and depth==1:require(middle is None,'one ELSE');middle=last
                    last+=1
                final=last-1;word=source(args[0],0);taken=word!=0;branches.append({'line':line,'predicateWord':word,'taken':taken})
                if taken:execute(at+1,final if middle is None else middle)
                elif middle is not None:execute(middle+1,final)
                at=last;continue
            if opcode=='END':break
            require(opcode not in ('ELSE','ENDIF'),'unexpected delimiter')
            match=re.fullmatch(r'(TEMP|OUT)\[(\d+)\](?:\.([xyzw]{1,4}))?',args[0]);require(match,'literal destination')
            key=(match[1],int(match[2]));mask=match[3] or 'xyzw';writes={}
            for char in mask:
                lane='xyzw'.index(char);values=[source(s,lane) for s in args[1:]]
                if opcode=='MOV':value=values[0]
                elif opcode=='UCMP':value=values[1] if values[0] else values[2]
                elif opcode=='UADD':value=(values[0]+values[1])%(2**32)
                elif opcode=='USHR':value=values[0]>>(values[1]%32)
                elif opcode=='AND':value=values[0]&values[1]
                elif opcode=='USEQ':value=2**32-1 if values[0]==values[1] else 0
                elif opcode=='ADD':value=exact_word(rational(values[0])+rational(values[1]))
                elif opcode=='MUL':value=exact_word(rational(values[0])*rational(values[1]))
                else:raise ValueError('unsupported literal opcode '+opcode)
                writes[lane]=value
            target=list(state.get(key,[None]*4))
            for lane,value in writes.items():target[lane]=value
            state[key]=target;at+=1
    execute(0,len(instructions));return source,branches,state


def pages(kernel,vector,fixture):
    shader=next(s for s in fixture['shaders'] if s['name']==kernel['name'])
    source,branches,_=interpret(shader['text'],{0:[float_word(-1),float_word(-1),0,float_word(1)],1:[0x30400000,0x30400000,0,0x3f800000],2:[0x3e800000,0x3f400000,0,0x3f800000],3:[0x3f000000,0x3e000000,0,0x3f800000]},bank(vector))
    return [[source(p['source'],lane) for lane in range(4)] for p in kernel['pages']],branches
