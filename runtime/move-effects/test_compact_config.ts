/** Feed the production encoder's v1/v2 records to the Thumb test oracle. */
import {writeFile} from "node:fs/promises";
import {MOVE_ALWAYS,newMoveEffect,encodeMoveRules,type MoveRuleSet} from "../../src/pokeweb/moveRules";
const power=newMoveEffect("power"),weather={kind:"weather" as const,value:3},always={conditions:MOVE_ALWAYS,prerequisites:MOVE_ALWAYS};
const cases:Array<{name:string;rule:MoveRuleSet;event?:string;expected:number;queries:number;count?:number;method?:string}>=[
 {name:"empty groups between multiple effects",rule:{...always,effects:[{...power,value:2},{...power,value:1.5}]},expected:120,queries:0},
 {name:"one weather query across nested conditions",rule:{...always,conditions:{kind:"group",mode:"all",children:[weather,weather]},effects:[{...power,value:2,conditions:weather},{...power,value:1.5,conditions:weather}]},expected:120,queries:1},
 {name:"failed global condition",rule:{...always,conditions:{kind:"weather",value:1},effects:[power]},expected:40,queries:1},
 {name:"failed use prerequisite",rule:{...always,prerequisites:{kind:"hp",subject:"user",comparison:"lt",percent:0},effects:[power]},event:"MoveEvent_1f",expected:26,queries:0,method:"prerequisite"},
 {name:"matchup adapter with omitted conditions",rule:{...always,effects:[{...newMoveEffect("typeMatchup"),value:10,parameters:{effectiveness:4}}]},expected:4,queries:0,method:"matchup"},
 {name:"identical persistent recipes retain separate move identities",rule:{...always,effects:[newMoveEffect("residualDamage")]},expected:26,queries:0,count:2,method:"persistent"},
 {name:"one immutable body serving 100 actual move IDs",rule:{...always,effects:[{...power,value:2}]},expected:80,queries:0,count:100},
];
await writeFile(process.argv[2],JSON.stringify(cases.map(c=>({...c,versions:[false,true].map(compact=>Array.from(encodeMoveRules(new Map(Array.from({length:c.count??1},(_,n)=>[n+1,c.rule])),18,compact)))}))));
